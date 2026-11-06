/*
 * The records the Cloud recommendations fixture draws: one AWS account a
 * connection reads, with the resources a team typically runs - a load
 * balancer in front of three machines (one of them so new its metrics have
 * not arrived), two databases (one whose inventory lists its storage), two
 * functions, a queue - and the ones no recommended monitor is for: a
 * network, a bucket, and a network load balancer, whose namespace no
 * template reads. Every value is made up.
 */

export const PROJECT_ID = "10000000-0000-4000-8000-000000000001";

export function uuid(prefix, number) {
  return `${prefix}-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

export const ACCOUNT_ID = uuid("30000000", 1);
export const AWS_ACCOUNT = "123456789012";
export const CONNECTION_ID = uuid("20000000", 1);

export const RESOURCE_IDS = {
  webAlb: uuid("40000000", 1),
  edgeNlb: uuid("40000000", 2),
  ordersDb: uuid("40000000", 3),
  reportsDb: uuid("40000000", 4),
  checkout: uuid("40000000", 5),
  nightlyExport: uuid("40000000", 6),
  web1: uuid("40000000", 7),
  web2: uuid("40000000", 8),
  web3: uuid("40000000", 9),
  ordersQueue: uuid("40000000", 10),
  prodVpc: uuid("40000000", 11),
  assetsBucket: uuid("40000000", 12),
  imageResizer: uuid("40000000", 13),
  // An App Platforms environment of the same account: never a cloud resource here.
  storefrontEnvironment: uuid("40000000", 14),
};

function attributes(namespace, dimensions, region) {
  const values = {
    Namespace: namespace,
    "resource.cloud.account.id": AWS_ACCOUNT,
    "resource.cloud.region": region,
  };

  for (const [name, value] of Object.entries(dimensions)) {
    values[`Dimensions.${name}`] = value;
  }

  return values;
}

function resource(id, fields, now) {
  return {
    _id: id,
    projectId: PROJECT_ID,
    cloudProvider: "aws",
    cloudAccountId: AWS_ACCOUNT,
    cloudResourceKind: "resource",
    cloudConnectionId: CONNECTION_ID,
    otelCollectorStatus: "connected",
    lastSeenAt: new Date(now - 3 * 60 * 1000),
    inventoriedAt: new Date(now - 22 * 60 * 1000),
    isArchived: false,
    labels: [],
    cloudTags: {},
    cloudReadings: {},
    ...fields,
  };
}

export function buildResources(now) {
  return [
    resource(
      RESOURCE_IDS.webAlb,
      {
        name: "web-alb",
        cloudResourceType: "AWS::ElasticLoadBalancingV2::LoadBalancer",
        providerResourceId:
          "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/web-alb/50dc6c495c0c9188",
        cloudRegion: "us-east-1",
        telemetryAttributes: attributes(
          "AWS/ApplicationELB",
          { LoadBalancer: "app/web-alb/50dc6c495c0c9188" },
          "us-east-1",
        ),
        cloudProperties: { Type: "application", Scheme: "internet-facing" },
      },
      now,
    ),
    resource(
      RESOURCE_IDS.edgeNlb,
      {
        name: "edge-nlb",
        cloudResourceType: "AWS::ElasticLoadBalancingV2::LoadBalancer",
        providerResourceId:
          "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/net/edge-nlb/7f1e2d3c4b5a6978",
        cloudRegion: "us-east-1",
        telemetryAttributes: attributes(
          "AWS/NetworkELB",
          { LoadBalancer: "net/edge-nlb/7f1e2d3c4b5a6978" },
          "us-east-1",
        ),
        cloudProperties: { Type: "network", Scheme: "internet-facing" },
      },
      now,
    ),
    resource(
      RESOURCE_IDS.ordersDb,
      {
        name: "orders-db",
        cloudResourceType: "AWS::RDS::DBInstance",
        providerResourceId: "orders-db",
        cloudRegion: "eu-west-1",
        telemetryAttributes: attributes(
          "AWS/RDS",
          { DBInstanceIdentifier: "orders-db" },
          "eu-west-1",
        ),
        cloudProperties: {
          DBInstanceClass: "db.r6g.large",
          Engine: "postgres",
          AllocatedStorage: 200,
        },
      },
      now,
    ),
    resource(
      RESOURCE_IDS.reportsDb,
      {
        name: "reports-db",
        cloudResourceType: "AWS::RDS::DBInstance",
        providerResourceId: "reports-db",
        cloudRegion: "eu-west-1",
        telemetryAttributes: attributes(
          "AWS/RDS",
          { DBInstanceIdentifier: "reports-db" },
          "eu-west-1",
        ),
        // Not listed by the inventory yet: no allocated storage known.
        cloudProperties: {},
      },
      now,
    ),
    resource(
      RESOURCE_IDS.checkout,
      {
        name: "checkout",
        cloudResourceType: "AWS::Lambda::Function",
        providerResourceId: "checkout",
        cloudRegion: "us-east-1",
        telemetryAttributes: attributes(
          "AWS/Lambda",
          { FunctionName: "checkout" },
          "us-east-1",
        ),
        cloudProperties: { Runtime: "nodejs20.x", MemorySize: 512 },
      },
      now,
    ),
    resource(
      RESOURCE_IDS.nightlyExport,
      {
        name: "nightly-export",
        cloudResourceType: "AWS::Lambda::Function",
        providerResourceId: "nightly-export",
        cloudRegion: "us-east-1",
        telemetryAttributes: attributes(
          "AWS/Lambda",
          { FunctionName: "nightly-export" },
          "us-east-1",
        ),
        cloudProperties: { Runtime: "python3.12", MemorySize: 1024 },
      },
      now,
    ),
    resource(
      RESOURCE_IDS.imageResizer,
      {
        // A long name, as a team's naming convention writes them.
        name: "storefront-production-image-resizer-eu-west-1-arm64",
        cloudResourceType: "AWS::Lambda::Function",
        providerResourceId:
          "storefront-production-image-resizer-eu-west-1-arm64",
        cloudRegion: "eu-west-1",
        telemetryAttributes: attributes(
          "AWS/Lambda",
          {
            FunctionName: "storefront-production-image-resizer-eu-west-1-arm64",
          },
          "eu-west-1",
        ),
        cloudProperties: { Runtime: "nodejs20.x", MemorySize: 2048 },
      },
      now,
    ),
    resource(
      RESOURCE_IDS.web1,
      {
        name: "web-1",
        cloudResourceType: "AWS::EC2::Instance",
        providerResourceId: "i-0a1b2c3d4e5f60001",
        cloudRegion: "us-east-1",
        telemetryAttributes: attributes(
          "AWS/EC2",
          { InstanceId: "i-0a1b2c3d4e5f60001" },
          "us-east-1",
        ),
        cloudProperties: { InstanceType: "t3.large" },
      },
      now,
    ),
    resource(
      RESOURCE_IDS.web2,
      {
        name: "web-2",
        cloudResourceType: "AWS::EC2::Instance",
        providerResourceId: "i-0a1b2c3d4e5f60002",
        cloudRegion: "us-east-1",
        telemetryAttributes: attributes(
          "AWS/EC2",
          { InstanceId: "i-0a1b2c3d4e5f60002" },
          "us-east-1",
        ),
        cloudProperties: { InstanceType: "t3.large" },
      },
      now,
    ),
    resource(
      RESOURCE_IDS.web3,
      {
        // Listed by the inventory a minute ago: its metrics have not arrived.
        name: "web-3",
        cloudResourceType: "AWS::EC2::Instance",
        providerResourceId: "i-0a1b2c3d4e5f60003",
        cloudRegion: "us-east-1",
        otelCollectorStatus: "disconnected",
        lastSeenAt: undefined,
        telemetryAttributes: {},
        cloudProperties: { InstanceType: "t3.large" },
      },
      now,
    ),
    resource(
      RESOURCE_IDS.ordersQueue,
      {
        name: "orders-queue",
        cloudResourceType: "AWS::SQS::Queue",
        providerResourceId:
          "https://sqs.eu-west-1.amazonaws.com/123456789012/orders-queue",
        cloudRegion: "eu-west-1",
        telemetryAttributes: attributes(
          "AWS/SQS",
          { QueueName: "orders-queue" },
          "eu-west-1",
        ),
        cloudProperties: { VisibilityTimeout: 30 },
      },
      now,
    ),
    resource(
      RESOURCE_IDS.prodVpc,
      {
        name: "prod-vpc",
        cloudResourceType: "AWS::EC2::VPC",
        providerResourceId: "vpc-0a1b2c3d4e5f60718",
        cloudRegion: "us-east-1",
        otelCollectorStatus: "disconnected",
        telemetryAttributes: {},
        cloudProperties: { CidrBlock: "10.0.0.0/16" },
      },
      now,
    ),
    resource(
      RESOURCE_IDS.assetsBucket,
      {
        name: "storefront-assets",
        cloudResourceType: "AWS::S3::Bucket",
        providerResourceId: "storefront-assets",
        cloudRegion: "us-east-1",
        telemetryAttributes: attributes(
          "AWS/S3",
          { BucketName: "storefront-assets", StorageType: "StandardStorage" },
          "us-east-1",
        ),
        cloudProperties: {},
      },
      now,
    ),
    resource(
      RESOURCE_IDS.storefrontEnvironment,
      {
        name: "AWS ECS us-east-1",
        cloudResourceKind: "environment",
        cloudResourceType: "aws_ecs",
        cloudRegion: "us-east-1",
        telemetryAttributes: {},
        cloudProperties: {},
      },
      now,
    ),
  ];
}

export function buildAccount(now) {
  return {
    _id: ACCOUNT_ID,
    projectId: PROJECT_ID,
    name: "Production",
    provider: "aws",
    accountId: AWS_ACCOUNT,
    providerAccountName: "Production",
    resourceCount: 13,
    lastSeenAt: new Date(now - 4 * 60 * 1000),
    cloudConnectionId: CONNECTION_ID,
    isArchived: false,
  };
}
