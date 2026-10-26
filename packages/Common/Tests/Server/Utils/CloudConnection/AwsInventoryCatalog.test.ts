import {
  AWS_INVENTORY_TYPES,
  AwsInventoryContext,
  AwsInventoryType,
  addAwsLoadBalancerEdges,
  arnResourceName,
  buildAwsInventoryItem,
  elbV2Dimension,
  getAwsInventoryIdentity,
  getAwsInventoryRowTypes,
  getAwsInventoryType,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsInventoryCatalog";
import { AwsListedResource } from "../../../../Server/Utils/CloudConnection/Aws/AwsCloudControl";
import { CloudInventoryItem } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { CloudRelationshipKind } from "../../../../Types/Cloud/CloudInventory";
import {
  CloudMonitoredResource,
  resolveCloudMonitoredResource,
} from "../../../../Types/Cloud/CloudMonitoredResource";
import {
  AWS_CLOUDWATCH_RESOURCE_RULES,
  AWS_RESOURCE_TYPES,
  getCloudResourceTypeDescriptor,
} from "../../../../Types/Cloud/CloudResourceCatalog";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { describe, expect, test } from "@jest/globals";

/*
 * The inventory's promise: a resource Cloud Control lists and the resource
 * its CloudWatch metrics name are ONE Cloud Resource. These tests list a
 * sample of every type and hold its identity to the one ingest's resolver
 * gives a datapoint about it - and pin what each keeps, what it is related
 * to and where it answers.
 */

const context: AwsInventoryContext = {
  accountId: "123456789012",
  region: "eu-west-1",
};

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

/*
 * The identity a CloudWatch datapoint about the resource gets, as the
 * cloud connection writes it: the namespace, the identity dimensions as
 * `Dimensions.<name>`, the account and the Region.
 */
function identityFromMetrics(
  namespace: string,
  dimensions: Record<string, string>,
): CloudMonitoredResource | null {
  const attributes: Record<string, string> = {
    Namespace: namespace,
    "resource.cloud.account.id": context.accountId,
    "resource.cloud.region": context.region,
  };

  for (const name of Object.keys(dimensions)) {
    attributes[`Dimensions.${name}`] = dimensions[name]!;
  }

  return resolveCloudMonitoredResource({
    metricName: `amazonaws.com/${namespace}/SomeMetric`,
    attributes,
  });
}

// One listed sample per type, with the metrics' own namespace and dimensions.
const SAMPLES: Array<{
  type: string;
  listed: AwsListedResource;
  namespace: string;
  dimensions: Record<string, string>;
}> = [
  {
    type: "AWS::EC2::Instance",
    listed: listed("i-0abc", { InstanceType: "m5.large" }),
    namespace: "AWS/EC2",
    dimensions: { InstanceId: "i-0abc" },
  },
  {
    type: "AWS::EC2::Volume",
    listed: listed("vol-0abc"),
    namespace: "AWS/EBS",
    dimensions: { VolumeId: "vol-0abc" },
  },
  {
    type: "AWS::EC2::NatGateway",
    listed: listed("nat-0abc"),
    namespace: "AWS/NATGateway",
    dimensions: { NatGatewayId: "nat-0abc" },
  },
  {
    type: "AWS::AutoScaling::AutoScalingGroup",
    listed: listed("web-asg"),
    namespace: "AWS/AutoScaling",
    dimensions: { AutoScalingGroupName: "web-asg" },
  },
  {
    type: "AWS::ElasticLoadBalancingV2::LoadBalancer",
    listed: listed(
      "arn:aws:elasticloadbalancing:eu-west-1:123456789012:loadbalancer/app/checkout/50dc6c495c0c9188",
      { Type: "application", LoadBalancerName: "checkout" },
    ),
    namespace: "AWS/ApplicationELB",
    dimensions: { LoadBalancer: "app/checkout/50dc6c495c0c9188" },
  },
  {
    type: "AWS::ECS::Cluster",
    listed: listed("orders", {
      ClusterName: "orders",
      Arn: "arn:aws:ecs:eu-west-1:123456789012:cluster/orders",
    }),
    namespace: "AWS/ECS",
    dimensions: { ClusterName: "orders" },
  },
  {
    type: "AWS::ECS::Service",
    listed: listed(
      "arn:aws:ecs:eu-west-1:123456789012:service/orders/api|arn:aws:ecs:eu-west-1:123456789012:cluster/orders",
      {
        ServiceName: "api",
        Cluster: "arn:aws:ecs:eu-west-1:123456789012:cluster/orders",
      },
    ),
    namespace: "AWS/ECS",
    dimensions: { ClusterName: "orders", ServiceName: "api" },
  },
  {
    type: "AWS::Lambda::Function",
    listed: listed("resize-images", { Runtime: "nodejs22.x" }),
    namespace: "AWS/Lambda",
    dimensions: { FunctionName: "resize-images" },
  },
  {
    type: "AWS::RDS::DBInstance",
    listed: listed("orders-db"),
    namespace: "AWS/RDS",
    dimensions: { DBInstanceIdentifier: "orders-db" },
  },
  {
    type: "AWS::RDS::DBCluster",
    listed: listed("orders-cluster"),
    namespace: "AWS/RDS",
    dimensions: { DBClusterIdentifier: "orders-cluster" },
  },
  {
    type: "AWS::ElastiCache::ReplicationGroup",
    listed: listed("sessions"),
    namespace: "AWS/ElastiCache",
    dimensions: { ReplicationGroupId: "sessions" },
  },
  {
    type: "AWS::SQS::Queue",
    listed: listed(
      "https://sqs.eu-west-1.amazonaws.com/123456789012/orders-queue",
    ),
    namespace: "AWS/SQS",
    dimensions: { QueueName: "orders-queue" },
  },
  {
    type: "AWS::SNS::Topic",
    listed: listed("arn:aws:sns:eu-west-1:123456789012:order-events"),
    namespace: "AWS/SNS",
    dimensions: { TopicName: "order-events" },
  },
  {
    type: "AWS::DynamoDB::Table",
    listed: listed("carts"),
    namespace: "AWS/DynamoDB",
    dimensions: { TableName: "carts" },
  },
  {
    type: "AWS::Kinesis::Stream",
    listed: listed("clicks"),
    namespace: "AWS/Kinesis",
    dimensions: { StreamName: "clicks" },
  },
  {
    type: "AWS::StepFunctions::StateMachine",
    listed: listed(
      "arn:aws:states:eu-west-1:123456789012:stateMachine:Checkout",
    ),
    namespace: "AWS/States",
    dimensions: {
      StateMachineArn:
        "arn:aws:states:eu-west-1:123456789012:stateMachine:Checkout",
    },
  },
  {
    type: "AWS::ApiGateway::RestApi",
    listed: listed("a1b2c3", { Name: "public-api" }),
    namespace: "AWS/ApiGateway",
    dimensions: { ApiName: "public-api" },
  },
  {
    type: "AWS::ApiGatewayV2::Api",
    listed: listed("x9y8z7", { Name: "webhooks" }),
    namespace: "AWS/ApiGateway",
    dimensions: { ApiId: "x9y8z7" },
  },
  {
    type: "AWS::EFS::FileSystem",
    listed: listed("fs-0abc"),
    namespace: "AWS/EFS",
    dimensions: { FileSystemId: "fs-0abc" },
  },
  {
    type: "AWS::OpenSearchService::Domain",
    listed: listed("logs"),
    namespace: "AWS/ES",
    dimensions: { DomainName: "logs" },
  },
  {
    type: "AWS::AppRunner::Service",
    listed: listed(
      "arn:aws:apprunner:eu-west-1:123456789012:service/frontend/abc",
      { ServiceName: "frontend" },
    ),
    namespace: "AWS/AppRunner",
    dimensions: { ServiceName: "frontend" },
  },
];

describe("identity", () => {
  test("every listed type with metrics has a sample here", () => {
    const sampled: Set<string> = new Set(
      SAMPLES.map((sample: { type: string }): string => {
        return sample.type;
      }),
    );

    for (const inventoryType of AWS_INVENTORY_TYPES) {
      if (inventoryType.metrics && !inventoryType.isGlobal) {
        expect(sampled.has(inventoryType.type)).toBe(true);
      }
    }
  });

  test.each(SAMPLES)(
    "a listed $type is the resource its metrics name",
    (sample: {
      type: string;
      listed: AwsListedResource;
      namespace: string;
      dimensions: Record<string, string>;
    }) => {
      const fromInventory: CloudMonitoredResource | null =
        getAwsInventoryIdentity(type(sample.type), sample.listed, context);
      const fromMetrics: CloudMonitoredResource | null = identityFromMetrics(
        sample.namespace,
        sample.dimensions,
      );

      expect(fromInventory).not.toBeNull();
      expect(fromMetrics).not.toBeNull();
      expect(fromInventory!.resourceType).toBe(sample.type);
      expect(fromInventory!.identityKey).toBe(fromMetrics!.identityKey);
      expect(fromInventory!.providerResourceId).toBe(
        fromMetrics!.providerResourceId,
      );
      expect(fromInventory!.telemetryAttributes).toEqual(
        fromMetrics!.telemetryAttributes,
      );
    },
  );

  test("CloudFront is listed in us-east-1, where its metrics are", () => {
    const cloudFront: AwsInventoryType = type("AWS::CloudFront::Distribution");
    const usEast: AwsInventoryContext = { ...context, region: "us-east-1" };
    const identity: CloudMonitoredResource | null = getAwsInventoryIdentity(
      cloudFront,
      listed("E2ABC"),
      usEast,
    );

    expect(cloudFront.isGlobal).toBe(true);
    expect(identity?.resourceType).toBe("AWS::CloudFront::Distribution");
    expect(identity?.region).toBe("us-east-1");
  });

  test("a network and a load balancer's namespace follow its type", () => {
    const loadBalancer: AwsInventoryType = type(
      "AWS::ElasticLoadBalancingV2::LoadBalancer",
    );
    const arn: string =
      "arn:aws:elasticloadbalancing:eu-west-1:123456789012:loadbalancer/net/edge/aa11";

    expect(
      loadBalancer.metrics!.namespace(listed(arn, { Type: "network" })),
    ).toBe("AWS/NetworkELB");
    expect(
      loadBalancer.metrics!.namespace(listed(arn, { Type: "gateway" })),
    ).toBe("AWS/GatewayELB");
    expect(loadBalancer.metrics!.namespace(listed(arn, {}))).toBe(
      "AWS/ApplicationELB",
    );
    expect(elbV2Dimension(arn)).toBe("net/edge/aa11");
    expect(elbV2Dimension("arn:aws:ec2:eu-west-1:1:instance/i-1")).toBe("");
  });

  test("a VPC, which has no metrics, gets an identity of the same shape from its id", () => {
    const identity: CloudMonitoredResource | null = getAwsInventoryIdentity(
      type("AWS::EC2::VPC"),
      listed("vpc-0abc"),
      context,
    );

    expect(identity).toEqual(
      expect.objectContaining({
        provider: CloudProvider.AWS,
        resourceType: "AWS::EC2::VPC",
        providerResourceId: "arn:aws:ec2:eu-west-1:123456789012:vpc/vpc-0abc",
        accountId: context.accountId,
        region: context.region,
        identityKey: "aws|123456789012|eu-west-1|aws::ec2::vpc|vpcid=vpc-0abc",
        telemetryAttributes: {},
      }),
    );
  });

  test("what names no resource is skipped, not guessed", () => {
    expect(
      getAwsInventoryIdentity(
        type("AWS::ApiGateway::RestApi"),
        listed("a1b2c3", {}),
        context,
      ),
    ).toBeNull();
    expect(
      getAwsInventoryIdentity(
        type("AWS::ElasticLoadBalancingV2::LoadBalancer"),
        listed("not-an-arn", {}),
        context,
      ),
    ).toBeNull();
    expect(
      getAwsInventoryIdentity(type("AWS::EC2::VPC"), listed("  "), context),
    ).toBeNull();
  });

  test("every listed type that makes rows is a type the catalog names", () => {
    for (const typeName of getAwsInventoryRowTypes()) {
      expect(
        getCloudResourceTypeDescriptor(CloudProvider.AWS, typeName),
      ).not.toBeNull();
    }
  });

  test("every metric type the inventory lists has a CloudWatch rule", () => {
    for (const inventoryType of AWS_INVENTORY_TYPES) {
      if (!inventoryType.metrics) {
        continue;
      }

      expect(
        AWS_CLOUDWATCH_RESOURCE_RULES.some(
          (rule: { type: string }): boolean => {
            return rule.type === inventoryType.type;
          },
        ),
      ).toBe(true);
      expect(
        AWS_RESOURCE_TYPES.some((descriptor: { type: string }): boolean => {
          return descriptor.type === inventoryType.type;
        }),
      ).toBe(true);
    }
  });

  test("S3 buckets are left to their metrics: Cloud Control does not say where a bucket lives", () => {
    expect(getAwsInventoryType("AWS::S3::Bucket")).toBeNull();
  });
});

describe("what an item keeps", () => {
  test("an instance: its Name tag, the properties it names, its network and its endpoints - never its user data", () => {
    const item: CloudInventoryItem | null = buildAwsInventoryItem(
      type("AWS::EC2::Instance"),
      listed("i-0abc", {
        InstanceType: "m5.large",
        SubnetId: "subnet-1",
        VpcId: "vpc-1",
        SecurityGroupIds: ["sg-1"],
        PublicDnsName: "ec2-1-2-3-4.eu-west-1.compute.amazonaws.com",
        PrivateIpAddress: "10.0.0.5",
        UserData: "c2VjcmV0",
        Tags: [
          { Key: "Name", Value: "web-1" },
          { Key: "team", Value: "storefront" },
        ],
      }),
      context,
    );

    expect(item?.displayName).toBe("web-1");
    expect(item?.tags).toEqual({ Name: "web-1", team: "storefront" });
    expect(item?.properties["InstanceType"]).toBe("m5.large");
    expect(JSON.stringify(item?.properties)).not.toContain("c2VjcmV0");
    expect(item?.relationships).toEqual([
      {
        kind: CloudRelationshipKind.RunsIn,
        target: "subnet-1",
        targetType: "AWS::EC2::Subnet",
      },
      {
        kind: CloudRelationshipKind.RunsIn,
        target: "vpc-1",
        targetType: "AWS::EC2::VPC",
      },
      {
        kind: CloudRelationshipKind.ProtectedBy,
        target: "sg-1",
        targetType: "AWS::EC2::SecurityGroup",
      },
    ]);
    expect(item?.endpoints).toEqual([
      "ec2-1-2-3-4.eu-west-1.compute.amazonaws.com",
      "10.0.0.5",
    ]);
  });

  test("a function never keeps its environment or code", () => {
    const item: CloudInventoryItem | null = buildAwsInventoryItem(
      type("AWS::Lambda::Function"),
      listed("resize-images", {
        Runtime: "nodejs22.x",
        Environment: { Variables: { API_KEY: "sk_live_123" } },
        Code: { ZipFile: "exports.handler = () => 'sk_live_123'" },
      }),
      context,
    );

    expect(item?.properties).toEqual({ Runtime: "nodejs22.x" });
    expect(JSON.stringify(item)).not.toContain("sk_live_123");
  });

  test("a database instance is part of its cluster - by the cluster's own ARN", () => {
    const instance: CloudInventoryItem | null = buildAwsInventoryItem(
      type("AWS::RDS::DBInstance"),
      listed("orders-db-1", {
        DBClusterIdentifier: "orders-cluster",
        Endpoint: { Address: "orders-db-1.abc.eu-west-1.rds.amazonaws.com" },
      }),
      context,
    );
    const cluster: CloudMonitoredResource | null = getAwsInventoryIdentity(
      type("AWS::RDS::DBCluster"),
      listed("orders-cluster"),
      context,
    );

    expect(instance?.relationships[0]).toEqual({
      kind: CloudRelationshipKind.PartOf,
      target: cluster?.providerResourceId,
      targetType: "AWS::RDS::DBCluster",
    });
    expect(instance?.endpoints).toEqual([
      "orders-db-1.abc.eu-west-1.rds.amazonaws.com",
    ]);
  });

  test("an ECS service is part of its cluster - by the cluster's own ARN", () => {
    const service: CloudInventoryItem | null = buildAwsInventoryItem(
      type("AWS::ECS::Service"),
      SAMPLES.find((sample: { type: string }): boolean => {
        return sample.type === "AWS::ECS::Service";
      })!.listed,
      context,
    );
    const cluster: CloudMonitoredResource | null = getAwsInventoryIdentity(
      type("AWS::ECS::Cluster"),
      SAMPLES.find((sample: { type: string }): boolean => {
        return sample.type === "AWS::ECS::Cluster";
      })!.listed,
      context,
    );

    expect(service?.relationships[0]?.kind).toBe(CloudRelationshipKind.PartOf);
    expect(service?.relationships[0]?.target.toLowerCase()).toBe(
      cluster?.providerResourceId.toLowerCase(),
    );
    expect(service?.displayName).toBe("api");
  });

  test("a queue names its dead-letter queue, in either shape CloudFormation writes", () => {
    const dlq: string = "arn:aws:sqs:eu-west-1:123456789012:orders-dlq";

    for (const policy of [
      { deadLetterTargetArn: dlq, maxReceiveCount: 5 },
      JSON.stringify({ deadLetterTargetArn: dlq, maxReceiveCount: 5 }),
    ]) {
      const item: CloudInventoryItem | null = buildAwsInventoryItem(
        type("AWS::SQS::Queue"),
        listed(
          "https://sqs.eu-west-1.amazonaws.com/123456789012/orders-queue",
          { RedrivePolicy: policy },
        ),
        context,
      );

      expect(item?.displayName).toBe("orders-queue");
      expect(item?.relationships).toEqual([
        {
          kind: CloudRelationshipKind.DeadLettersTo,
          target: dlq,
          targetType: "AWS::SQS::Queue",
        },
      ]);
    }
  });

  test("a topic routes to the AWS resources that subscribe, not to email addresses", () => {
    const item: CloudInventoryItem | null = buildAwsInventoryItem(
      type("AWS::SNS::Topic"),
      listed("arn:aws:sns:eu-west-1:123456789012:order-events", {
        Subscription: [
          {
            Endpoint: "arn:aws:sqs:eu-west-1:123456789012:orders-queue",
            Protocol: "sqs",
          },
          { Endpoint: "ops@example.com", Protocol: "email" },
        ],
      }),
      context,
    );

    expect(item?.relationships).toEqual([
      {
        kind: CloudRelationshipKind.RoutesTo,
        target: "arn:aws:sqs:eu-west-1:123456789012:orders-queue",
      },
    ]);
    expect(JSON.stringify(item)).not.toContain("ops@example.com");
  });

  test("a distribution answers on its domain and aliases, and routes to its origins", () => {
    const item: CloudInventoryItem | null = buildAwsInventoryItem(
      type("AWS::CloudFront::Distribution"),
      listed("E2ABC", {
        DomainName: "d111111abcdef8.cloudfront.net",
        DistributionConfig: {
          Aliases: ["www.example.com"],
          Origins: [
            {
              DomainName: "checkout-123.eu-west-1.elb.amazonaws.com",
            },
          ],
        },
      }),
      { ...context, region: "us-east-1" },
    );

    expect(item?.endpoints).toEqual([
      "d111111abcdef8.cloudfront.net",
      "www.example.com",
    ]);
    expect(item?.relationships).toContainEqual({
      kind: CloudRelationshipKind.RoutesTo,
      target: "checkout-123.eu-west-1.elb.amazonaws.com",
    });
  });

  test("a REST API answers on its execute-api host", () => {
    const item: CloudInventoryItem | null = buildAwsInventoryItem(
      type("AWS::ApiGateway::RestApi"),
      listed("a1b2c3", { Name: "public-api" }),
      context,
    );

    expect(item?.endpoints).toEqual([
      "a1b2c3.execute-api.eu-west-1.amazonaws.com",
    ]);
  });

  test("target groups make no rows of their own", () => {
    expect(
      buildAwsInventoryItem(
        type("AWS::ElasticLoadBalancingV2::TargetGroup"),
        listed("arn:aws:elasticloadbalancing:eu-west-1:1:targetgroup/web/1"),
        context,
      ),
    ).toBeNull();
    expect(getAwsInventoryRowTypes()).not.toContain(
      "AWS::ElasticLoadBalancingV2::TargetGroup",
    );
  });
});

describe("what a load balancer sends traffic to", () => {
  const loadBalancerArn: string =
    "arn:aws:elasticloadbalancing:eu-west-1:123456789012:loadbalancer/app/checkout/50dc6c495c0c9188";

  test("its instance targets, its ECS services and its Auto Scaling groups, through their target groups", () => {
    const loadBalancer: AwsListedResource = listed(loadBalancerArn, {
      Type: "application",
    });
    const service: AwsListedResource = listed("svc|cluster", {
      ServiceName: "api",
      Cluster: "arn:aws:ecs:eu-west-1:123456789012:cluster/orders",
      LoadBalancers: [
        {
          TargetGroupArn:
            "arn:aws:elasticloadbalancing:eu-west-1:123456789012:targetgroup/api/2",
        },
      ],
    });
    const group: AwsListedResource = listed("web-asg", {
      TargetGroupARNs: [
        "arn:aws:elasticloadbalancing:eu-west-1:123456789012:targetgroup/web/3",
      ],
    });

    const items: Array<CloudInventoryItem> = [];
    const listedByItem: Map<CloudInventoryItem, AwsListedResource> = new Map();

    for (const [typeName, resource] of [
      ["AWS::ElasticLoadBalancingV2::LoadBalancer", loadBalancer],
      ["AWS::ECS::Service", service],
      ["AWS::AutoScaling::AutoScalingGroup", group],
    ] as Array<[string, AwsListedResource]>) {
      const item: CloudInventoryItem = buildAwsInventoryItem(
        type(typeName),
        resource,
        context,
      )!;
      items.push(item);
      listedByItem.set(item, resource);
    }

    addAwsLoadBalancerEdges({
      items,
      listedByItem,
      context,
      targetGroups: [
        listed(
          "arn:aws:elasticloadbalancing:eu-west-1:123456789012:targetgroup/instances/1",
          {
            LoadBalancerArns: [loadBalancerArn],
            TargetType: "instance",
            Targets: [{ Id: "i-0abc", Port: 80 }],
          },
        ),
        listed(
          "arn:aws:elasticloadbalancing:eu-west-1:123456789012:targetgroup/api/2",
          { LoadBalancerArns: [loadBalancerArn], TargetType: "ip" },
        ),
        listed(
          "arn:aws:elasticloadbalancing:eu-west-1:123456789012:targetgroup/web/3",
          { LoadBalancerArns: [loadBalancerArn], TargetType: "instance" },
        ),
      ],
    });

    const routes: Array<string> = items[0]!.relationships
      .filter((relationship: { kind: CloudRelationshipKind }): boolean => {
        return relationship.kind === CloudRelationshipKind.RoutesTo;
      })
      .map((relationship: { target: string }): string => {
        return relationship.target;
      });

    expect(routes).toEqual([
      "arn:aws:ec2:eu-west-1:123456789012:instance/i-0abc",
      items[1]!.resource.providerResourceId,
      items[2]!.resource.providerResourceId,
    ]);
  });

  test("a target group of another load balancer adds nothing", () => {
    const item: CloudInventoryItem = buildAwsInventoryItem(
      type("AWS::ElasticLoadBalancingV2::LoadBalancer"),
      listed(loadBalancerArn, { Type: "application" }),
      context,
    )!;

    addAwsLoadBalancerEdges({
      items: [item],
      listedByItem: new Map(),
      context,
      targetGroups: [
        listed("arn:...:targetgroup/other/9", {
          LoadBalancerArns: [
            "arn:aws:elasticloadbalancing:eu-west-1:1:loadbalancer/app/other/1",
          ],
          TargetType: "instance",
          Targets: [{ Id: "i-9" }],
        }),
      ],
    });

    expect(item.relationships).toEqual([]);
  });
});

describe("helpers", () => {
  test("an ARN's resource name is what follows its last slash or colon", () => {
    expect(arnResourceName("arn:aws:ecs:eu-west-1:1:cluster/orders")).toBe(
      "orders",
    );
    expect(
      arnResourceName("arn:aws:states:eu-west-1:1:stateMachine:Checkout"),
    ).toBe("Checkout");
    expect(arnResourceName("plain")).toBe("plain");
    expect(arnResourceName("ends/")).toBe("ends/");
  });
});
