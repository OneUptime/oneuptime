import {
  AWS_LOG_GROUP_RESOURCE_TYPES,
  AWS_LOG_GROUP_RULES,
  CLOUD_RESOURCE_ID_ATTRIBUTE,
  CloudLogGroupResource,
  STORED_CLOUD_RESOURCE_ID_ATTRIBUTE,
  canCloudResourceHaveStreamedLogs,
  getAwsLogGroupResource,
} from "../../../Types/Cloud/CloudLogGroups";
import {
  CloudMonitoredResource,
  resolveCloudMonitoredResource,
} from "../../../Types/Cloud/CloudMonitoredResource";
import { getCloudResourceTypeLabel } from "../../../Types/Cloud/CloudResourceCatalog";
import { describe, expect, test } from "@jest/globals";

/*
 * A streamed log group is filed under the resource its name says it is the
 * log of - and that resource must be the very row the resource's own
 * CloudWatch metrics are filed under, or its Logs page would show nothing.
 * So each rule is held to the ingest's metric resolver: the same identity,
 * type and ARN as a datapoint of that resource.
 */

const ACCOUNT: string = "123456789012";
const REGION: string = "us-east-1";

// The resource a CloudWatch datapoint of the namespace and dimensions is filed under.
function fromMetrics(data: {
  namespace: string;
  dimensions: Record<string, string>;
  region?: string;
}): CloudMonitoredResource {
  const attributes: Record<string, string> = {
    Namespace: data.namespace,
    "resource.cloud.account.id": ACCOUNT,
    "resource.cloud.region": data.region || REGION,
  };

  for (const [name, value] of Object.entries(data.dimensions)) {
    attributes[`Dimensions.${name}`] = value;
  }

  const resource: CloudMonitoredResource | null = resolveCloudMonitoredResource(
    {
      metricName: `amazonaws.com/${data.namespace}/AnyMetric`,
      attributes,
    },
  );

  expect(resource).not.toBeNull();
  return resource!;
}

function fromLogs(
  logGroup: string,
  region: string = REGION,
): CloudLogGroupResource {
  const filed: CloudLogGroupResource | null = getAwsLogGroupResource({
    logGroup,
    accountId: ACCOUNT,
    region,
  });

  expect(filed).not.toBeNull();
  return filed!;
}

describe("log groups AWS names after their resource", () => {
  test.each([
    {
      logGroup: "/aws/lambda/checkout",
      namespace: "AWS/Lambda",
      dimensions: { FunctionName: "checkout" },
      arn: "arn:aws:lambda:us-east-1:123456789012:function:checkout",
    },
    {
      logGroup: "/aws/rds/instance/orders-db/error",
      namespace: "AWS/RDS",
      dimensions: { DBInstanceIdentifier: "orders-db" },
      arn: "arn:aws:rds:us-east-1:123456789012:db:orders-db",
    },
    {
      logGroup: "/aws/rds/instance/orders-db/postgresql",
      namespace: "AWS/RDS",
      dimensions: { DBInstanceIdentifier: "orders-db" },
      arn: "arn:aws:rds:us-east-1:123456789012:db:orders-db",
    },
    {
      logGroup: "/aws/rds/cluster/orders-aurora/slowquery",
      namespace: "AWS/RDS",
      dimensions: { DBClusterIdentifier: "orders-aurora" },
      arn: "arn:aws:rds:us-east-1:123456789012:cluster:orders-aurora",
    },
    {
      logGroup: "/aws/docdb/catalog/audit",
      namespace: "AWS/DocDB",
      dimensions: { DBClusterIdentifier: "catalog" },
      arn: "arn:aws:rds:us-east-1:123456789012:cluster:catalog",
    },
    {
      logGroup: "/aws/neptune/graph/audit",
      namespace: "AWS/Neptune",
      dimensions: { DBClusterIdentifier: "graph" },
      arn: "arn:aws:rds:us-east-1:123456789012:cluster:graph",
    },
    {
      logGroup: "/aws/redshift/cluster/warehouse/connectionlog",
      namespace: "AWS/Redshift",
      dimensions: { ClusterIdentifier: "warehouse" },
      arn: "arn:aws:redshift:us-east-1:123456789012:cluster:warehouse",
    },
    {
      logGroup: "/aws/OpenSearchService/domains/search/application-logs",
      namespace: "AWS/ES",
      dimensions: { DomainName: "search" },
      arn: "arn:aws:es:us-east-1:123456789012:domain/search",
    },
    {
      logGroup: "/aws/aes/domains/search/search-logs",
      namespace: "AWS/ES",
      dimensions: { DomainName: "search" },
      arn: "arn:aws:es:us-east-1:123456789012:domain/search",
    },
    {
      logGroup: "/aws/apprunner/storefront/8a7b6c5d4e3f/application",
      namespace: "AWS/AppRunner",
      dimensions: { ServiceName: "storefront", ServiceID: "8a7b6c5d4e3f" },
      arn: "arn:aws:apprunner:us-east-1:123456789012:service/storefront/8a7b6c5d4e3f",
    },
    {
      logGroup: "/aws/ecs/containerinsights/production/performance",
      namespace: "AWS/ECS",
      dimensions: { ClusterName: "production" },
      arn: "arn:aws:ecs:us-east-1:123456789012:cluster/production",
    },
  ])(
    "$logGroup is the log of the resource its metrics are filed under",
    (example: {
      logGroup: string;
      namespace: string;
      dimensions: Record<string, string>;
      arn: string;
    }) => {
      const filed: CloudLogGroupResource = fromLogs(example.logGroup);
      const metrics: CloudMonitoredResource = fromMetrics(example);

      expect(filed.resource.identityKey).toBe(metrics.identityKey);
      expect(filed.resource.resourceType).toBe(metrics.resourceType);
      expect(filed.resource.providerResourceId).toBe(example.arn);
      expect(filed.attributes[CLOUD_RESOURCE_ID_ATTRIBUTE]).toBe(example.arn);
    },
  );

  test("an Elastic Beanstalk environment, which no ARN names from a metric", () => {
    const filed: CloudLogGroupResource = fromLogs(
      "/aws/elasticbeanstalk/storefront-prod/var/log/web.stdout.log",
    );
    const metrics: CloudMonitoredResource = fromMetrics({
      namespace: "AWS/ElasticBeanstalk",
      dimensions: { EnvironmentName: "storefront-prod" },
    });

    expect(filed.resource.identityKey).toBe(metrics.identityKey);
    expect(filed.attributes[CLOUD_RESOURCE_ID_ATTRIBUTE]).toBe(
      metrics.providerResourceId,
    );
  });

  test("a function's logs are the function's in Serverless too", () => {
    expect(fromLogs("/aws/lambda/checkout").attributes).toEqual({
      [CLOUD_RESOURCE_ID_ATTRIBUTE]:
        "arn:aws:lambda:us-east-1:123456789012:function:checkout",
      "cloud.platform": "aws_lambda",
      "faas.name": "checkout",
    });
  });

  test("a Lambda@Edge replica's log, in any Region, is the function's in us-east-1", () => {
    const filed: CloudLogGroupResource = fromLogs(
      "/aws/lambda/us-east-1.edge-auth",
      "eu-west-2",
    );

    expect(filed.resource.identityKey).toBe(
      fromMetrics({
        namespace: "AWS/Lambda",
        dimensions: { FunctionName: "edge-auth" },
        region: "us-east-1",
      }).identityKey,
    );
    expect(filed.attributes["faas.name"]).toBe("edge-auth");
  });

  test("a GovCloud or China function gets its partition's ARN", () => {
    expect(
      fromLogs("/aws/lambda/checkout", "us-gov-west-1").resource
        .providerResourceId,
    ).toBe(
      "arn:aws-us-gov:lambda:us-gov-west-1:123456789012:function:checkout",
    );
    expect(
      fromLogs("/aws/lambda/checkout", "cn-north-1").resource
        .providerResourceId,
    ).toBe("arn:aws-cn:lambda:cn-north-1:123456789012:function:checkout");
  });

  test("every rule's type is a type the catalog names", () => {
    for (const rule of AWS_LOG_GROUP_RULES) {
      expect(getCloudResourceTypeLabel("aws", rule.type)).not.toBe(rule.type);
    }
  });
});

describe("log groups no rule reads", () => {
  test.each([
    // A team's own, an API Gateway's execution log, VPC flow logs, CloudTrail's.
    "/my-team/app",
    "API-Gateway-Execution-Logs_a1b2c3d4e5/prod",
    "vpc-flow-logs",
    "aws-cloudtrail-logs-123456789012-abcdef",
    // The service's prefix with no resource after it.
    "/aws/lambda/",
    "/aws/rds/instance/",
    "/aws/rds/instance/orders-db",
    "/aws/lambda/a/b",
    "/aws/apprunner/storefront",
    // Not AWS's spelling.
    "/aws/Lambda/checkout",
    "",
  ])("%s is unfiled", (logGroup: string) => {
    expect(
      getAwsLogGroupResource({ logGroup, accountId: ACCOUNT, region: REGION }),
    ).toBeNull();
  });

  test("a group of no account, a name longer than CloudWatch Logs allows, or an identity longer than any is unfiled", () => {
    expect(
      getAwsLogGroupResource({
        logGroup: "/aws/lambda/checkout",
        accountId: "",
        region: REGION,
      }),
    ).toBeNull();
    expect(
      getAwsLogGroupResource({
        logGroup: `/aws/lambda/${"x".repeat(520)}`,
        accountId: ACCOUNT,
        region: REGION,
      }),
    ).toBeNull();
    expect(
      getAwsLogGroupResource({
        logGroup: `/aws/lambda/${"x".repeat(300)}`,
        accountId: ACCOUNT,
        region: REGION,
      }),
    ).toBeNull();
  });

  test("a name of slashes after a prefix is no resource", () => {
    expect(
      getAwsLogGroupResource({
        logGroup: `/aws/rds/instance/${"/".repeat(494)}`,
        accountId: ACCOUNT,
        region: REGION,
      }),
    ).toBeNull();
  });
});

describe("which resource pages have a Logs tab", () => {
  test("the AWS types a log group names", () => {
    expect(Array.from(AWS_LOG_GROUP_RESOURCE_TYPES).sort()).toEqual(
      [
        "AWS::AppRunner::Service",
        "AWS::DocDB::DBCluster",
        "AWS::ECS::Cluster",
        "AWS::ElasticBeanstalk::Environment",
        "AWS::Lambda::Function",
        "AWS::Neptune::DBCluster",
        "AWS::OpenSearchService::Domain",
        "AWS::RDS::DBCluster",
        "AWS::RDS::DBInstance",
        "AWS::Redshift::Cluster",
      ].sort(),
    );

    expect(
      canCloudResourceHaveStreamedLogs({
        provider: "aws",
        type: "AWS::Lambda::Function",
      }),
    ).toBe(true);
    expect(
      canCloudResourceHaveStreamedLogs({
        provider: "AWS",
        type: "AWS::RDS::DBInstance",
      }),
    ).toBe(true);
  });

  test("not a volume, a network, or another cloud's resource", () => {
    for (const data of [
      { provider: "aws", type: "AWS::EC2::Volume" },
      { provider: "aws", type: "AWS::EC2::VPC" },
      { provider: "azure", type: "AWS::Lambda::Function" },
      { provider: null, type: null },
    ]) {
      expect(canCloudResourceHaveStreamedLogs(data)).toBe(false);
    }
  });

  test("filters on the stored resource attribute the logs carry", () => {
    expect(STORED_CLOUD_RESOURCE_ID_ATTRIBUTE).toBe(
      "resource.cloud.resource_id",
    );
  });
});
