import {
  AWS_LOG_GROUP_ENVIRONMENT_RULES,
  AWS_LOG_GROUP_PLATFORMS,
  AWS_LOG_GROUP_RESOURCE_TYPES,
  AWS_LOG_GROUP_RULES,
  CLOUD_PLATFORM_ATTRIBUTE,
  CLOUD_RESOURCE_ID_ATTRIBUTE,
  CloudLogGroupResource,
  ECS_CLUSTER_ARN_ATTRIBUTE,
  ECS_TASK_FAMILY_ATTRIBUTE,
  STORED_CLOUD_RESOURCE_ID_ATTRIBUTE,
  AZURE_TYPES_WITHOUT_RESOURCE_LOGS,
  GCP_TYPES_WITHOUT_LOGS,
  TASK_DEFINITION_FAMILY_MAX_LENGTH,
  canCloudResourceHaveStreamedLogs,
  getAwsLogGroupAttributes,
  getAwsLogGroupEnvironmentAttributes,
  getAwsLogGroupResource,
} from "../../../Types/Cloud/CloudLogGroups";
import {
  CloudMonitoredResource,
  resolveCloudMonitoredResource,
} from "../../../Types/Cloud/CloudMonitoredResource";
import {
  CloudProvider,
  ManagedCloudPlatform,
  buildCloudEnvironmentKey,
  getCloudProviderForPlatform,
  getManagedCloudPlatformDescriptor,
  isManagedCloudPlatform,
} from "../../../Types/Cloud/CloudPlatform";
import {
  AZURE_RESOURCE_TYPES,
  CloudResourceTypeDescriptor,
  getCloudResourceTypeLabel,
} from "../../../Types/Cloud/CloudResourceCatalog";
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
    {
      // The name the Step Functions console gives a state machine's log group.
      logGroup: "/aws/vendedlogs/states/order-flow-Logs",
      namespace: "AWS/States",
      dimensions: {
        StateMachineArn:
          "arn:aws:states:us-east-1:123456789012:stateMachine:order-flow",
      },
      arn: "arn:aws:states:us-east-1:123456789012:stateMachine:order-flow",
    },
    {
      // A name that ends in -Logs itself keeps the rest: only one suffix goes.
      logGroup: "/aws/vendedlogs/states/audit_Logs-Logs",
      namespace: "AWS/States",
      dimensions: {
        StateMachineArn:
          "arn:aws:states:us-east-1:123456789012:stateMachine:audit_Logs",
      },
      arn: "arn:aws:states:us-east-1:123456789012:stateMachine:audit_Logs",
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

  test("a state machine's ARN is its group's Region's and partition's, and its metrics' too", () => {
    for (const [region, partition] of [
      ["eu-central-1", "aws"],
      ["us-gov-east-1", "aws-us-gov"],
      ["cn-northwest-1", "aws-cn"],
    ]) {
      const filed: CloudLogGroupResource = fromLogs(
        "/aws/vendedlogs/states/order-flow-Logs",
        region!,
      );
      const arn: string = `arn:${partition}:states:${region}:123456789012:stateMachine:order-flow`;

      expect(filed.resource.providerResourceId).toBe(arn);
      expect(filed.attributes).toEqual({ [CLOUD_RESOURCE_ID_ATTRIBUTE]: arn });
      expect(filed.resource.identityKey).toBe(
        fromMetrics({
          namespace: "AWS/States",
          dimensions: { StateMachineArn: arn },
          region: region!,
        }).identityKey,
      );
    }
  });

  test("a state machine's group in an upper-case Region is read in AWS's own spelling", () => {
    expect(
      fromLogs("/aws/vendedlogs/states/order-flow-Logs", "EU-WEST-1").resource
        .providerResourceId,
    ).toBe("arn:aws:states:eu-west-1:123456789012:stateMachine:order-flow");
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
    /*
     * An ECS task's group names its task definition's family, which is no
     * resource of the catalog (its environment's, below), and a CodeBuild
     * project is no type the catalog has yet.
     */
    "/ecs/storefront",
    "/aws/codebuild/build-storefront",
    // A Step Functions group the console did not name, or no state machine's name.
    "/aws/vendedlogs/states/order-flow",
    "/aws/vendedlogs/states/-Logs",
    "/aws/vendedlogs/states/flows/order-flow-Logs",
    "/aws/vendedlogs/states/order.flow-Logs",
    `/aws/vendedlogs/states/${"s".repeat(81)}-Logs`,
    "/aws/vendedlogs/states/order-flow-logs",
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

  test("a state machine's group of no account or no AWS Region is unfiled: its ARN needs both", () => {
    for (const place of [
      { accountId: "", region: REGION },
      { accountId: ACCOUNT, region: "" },
      { accountId: ACCOUNT, region: "europe" },
      { accountId: ACCOUNT, region: "us_east_1" },
    ]) {
      expect(
        getAwsLogGroupResource({
          logGroup: "/aws/vendedlogs/states/order-flow-Logs",
          ...place,
        }),
      ).toBeNull();
    }
  });

  test("a state machine name of 80 characters, the most AWS allows, is still read", () => {
    const name: string = "s".repeat(80);

    expect(
      fromLogs(`/aws/vendedlogs/states/${name}-Logs`).resource
        .providerResourceId,
    ).toBe(`arn:aws:states:us-east-1:123456789012:stateMachine:${name}`);
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
        "AWS::StepFunctions::StateMachine",
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
      { provider: "gcp", type: "AWS::Lambda::Function" },
      { provider: "aws", type: "Microsoft.Web/sites" },
      { provider: null, type: null },
    ]) {
      expect(canCloudResourceHaveStreamedLogs(data)).toBe(false);
    }
  });

  test("every Azure type of the catalog whose diagnostic settings send logs, whatever its case", () => {
    for (const type of [
      "Microsoft.Web/sites",
      "Microsoft.Sql/servers/databases",
      "Microsoft.KeyVault/vaults",
      "Microsoft.ContainerService/managedClusters",
      "Microsoft.App/managedEnvironments",
      "Microsoft.Network/applicationGateways",
      "Microsoft.DocumentDB/databaseAccounts",
      "microsoft.web/SITES",
    ]) {
      expect(
        canCloudResourceHaveStreamedLogs({ provider: "azure", type }),
      ).toBe(true);
    }

    // Every type the catalog lists either has the tab or is named as having no logs.
    const listed: Array<string> = AZURE_RESOURCE_TYPES.map(
      (descriptor: CloudResourceTypeDescriptor): string => {
        return descriptor.type;
      },
    );
    const withoutTab: Array<string> = listed.filter((type: string): boolean => {
      return !canCloudResourceHaveStreamedLogs({ provider: "Azure", type });
    });

    expect(
      withoutTab
        .map((type: string) => {
          return type.toLowerCase();
        })
        .sort(),
    ).toEqual(Array.from(AZURE_TYPES_WITHOUT_RESOURCE_LOGS).sort());
  });

  test("no Azure tab for a resource with no logs of its own, nor for a type no stream sets diagnostic settings on", () => {
    for (const type of [
      "Microsoft.Compute/virtualMachines",
      "Microsoft.Compute/disks",
      "Microsoft.Network/virtualNetworks",
      "Microsoft.Storage/storageAccounts",
      "Microsoft.Web/serverfarms",
      "Microsoft.App/containerApps",
      // Not in the catalog: the stream's command sets no diagnostic setting on it.
      "Microsoft.Network/networkSecurityGroups",
      "",
    ]) {
      expect(
        canCloudResourceHaveStreamedLogs({ provider: "azure", type }),
      ).toBe(false);
    }
  });

  test("the Google Cloud types Cloud Logging files logs under, and not an instance group nor a type of no rule", () => {
    for (const type of [
      "gce_instance",
      "cloud_run_revision",
      "cloud_function",
      "cloudsql_database",
      "https_lb_rule",
      "internal_http_lb_rule",
      "gcs_bucket",
      "pubsub_subscription",
    ]) {
      expect(canCloudResourceHaveStreamedLogs({ provider: "gcp", type })).toBe(
        true,
      );
    }

    for (const type of [
      "instance_group",
      "http_load_balancer",
      "k8s_container",
      "",
    ]) {
      expect(canCloudResourceHaveStreamedLogs({ provider: "GCP", type })).toBe(
        false,
      );
    }

    expect(Array.from(GCP_TYPES_WITHOUT_LOGS)).toEqual(["instance_group"]);
  });

  test("filters on the stored resource attribute the logs carry", () => {
    expect(STORED_CLOUD_RESOURCE_ID_ATTRIBUTE).toBe(
      "resource.cloud.resource_id",
    );
  });
});

/*
 * An App Platforms environment is a managed platform in one account and
 * Region (CloudPlatform: buildCloudEnvironmentKey), and its Logs tab
 * filters on resource.cloud.platform, resource.cloud.account.id and
 * resource.cloud.region. Every streamed log carries the account and the
 * Region; these rules give the logs of an App Runner service, an Elastic
 * Beanstalk environment and an ECS cluster or task their platform, so they
 * are that environment's logs too - and say nothing of an app.
 */
describe("log groups of an App Platforms platform", () => {
  const CLUSTER_ARN: string =
    "arn:aws:ecs:us-east-1:123456789012:cluster/production";

  test.each([
    {
      logGroup: "/aws/apprunner/storefront/8a7b6c5d4e3f/application",
      attributes: {
        [CLOUD_RESOURCE_ID_ATTRIBUTE]:
          "arn:aws:apprunner:us-east-1:123456789012:service/storefront/8a7b6c5d4e3f",
        [CLOUD_PLATFORM_ATTRIBUTE]: "aws_app_runner",
      },
    },
    {
      // A service's own events: deployments, health checks.
      logGroup: "/aws/apprunner/storefront/8a7b6c5d4e3f/service",
      attributes: {
        [CLOUD_RESOURCE_ID_ATTRIBUTE]:
          "arn:aws:apprunner:us-east-1:123456789012:service/storefront/8a7b6c5d4e3f",
        [CLOUD_PLATFORM_ATTRIBUTE]: "aws_app_runner",
      },
    },
    {
      logGroup: "/aws/elasticbeanstalk/storefront-prod/var/log/web.stdout.log",
      attributes: {
        [CLOUD_RESOURCE_ID_ATTRIBUTE]: fromMetrics({
          namespace: "AWS/ElasticBeanstalk",
          dimensions: { EnvironmentName: "storefront-prod" },
        }).providerResourceId,
        [CLOUD_PLATFORM_ATTRIBUTE]: "aws_elastic_beanstalk",
      },
    },
    {
      logGroup: "/aws/ecs/containerinsights/production/performance",
      attributes: {
        [CLOUD_RESOURCE_ID_ATTRIBUTE]: CLUSTER_ARN,
        [ECS_CLUSTER_ARN_ATTRIBUTE]: CLUSTER_ARN,
        [CLOUD_PLATFORM_ATTRIBUTE]: "aws_ecs",
      },
    },
  ])(
    "$logGroup: its resource's id and its platform",
    (example: { logGroup: string; attributes: Record<string, string> }) => {
      expect(fromLogs(example.logGroup).attributes).toEqual(example.attributes);
      expect(
        getAwsLogGroupAttributes({
          logGroup: example.logGroup,
          accountId: ACCOUNT,
          region: REGION,
        }),
      ).toEqual(example.attributes);
    },
  );

  test("an ECS task's group, as the ECS console names it, is its account's ECS environment, narrowed to the family", () => {
    const attributes: Record<string, string> = getAwsLogGroupAttributes({
      logGroup: "/ecs/storefront-web",
      accountId: ACCOUNT,
      region: REGION,
    });

    expect(attributes).toEqual({
      [CLOUD_PLATFORM_ATTRIBUTE]: "aws_ecs",
      [ECS_TASK_FAMILY_ATTRIBUTE]: "storefront-web",
    });
    // No resource of the catalog: no Cloud page's Logs tab filters on it.
    expect(attributes[CLOUD_RESOURCE_ID_ATTRIBUTE]).toBeUndefined();
    expect(
      getAwsLogGroupResource({
        logGroup: "/ecs/storefront-web",
        accountId: ACCOUNT,
        region: REGION,
      }),
    ).toBeNull();
  });

  test("the cluster's ARN is the one the ECS resource detector writes, in the Region's partition", () => {
    for (const [region, partition] of [
      ["us-east-1", "aws"],
      ["us-gov-west-1", "aws-us-gov"],
      ["cn-north-1", "aws-cn"],
    ]) {
      const filed: CloudLogGroupResource = fromLogs(
        "/aws/ecs/containerinsights/production/performance",
        region!,
      );
      const arn: string = `arn:${partition}:ecs:${region}:123456789012:cluster/production`;

      expect(filed.attributes[ECS_CLUSTER_ARN_ATTRIBUTE]).toBe(arn);
      expect(filed.resource.providerResourceId).toBe(arn);
    }
  });

  test("with the account and Region every streamed log carries, each is the environment an app on the platform reports to", () => {
    for (const [logGroup, key] of [
      [
        "/aws/apprunner/storefront/8a7b6c5d4e3f/application",
        "aws_app_runner|123456789012|us-east-1",
      ],
      [
        "/aws/elasticbeanstalk/storefront-prod/var/log/eb-engine.log",
        "aws_elastic_beanstalk|123456789012|us-east-1",
      ],
      [
        "/aws/ecs/containerinsights/production/performance",
        "aws_ecs|123456789012|us-east-1",
      ],
      ["/ecs/storefront-web", "aws_ecs|123456789012|us-east-1"],
    ]) {
      const platform: string | undefined = getAwsLogGroupAttributes({
        logGroup: logGroup!,
        accountId: ACCOUNT,
        region: REGION,
      })[CLOUD_PLATFORM_ATTRIBUTE];

      expect({ logGroup, platform }).toEqual({
        logGroup,
        platform: expect.any(String),
      });
      expect(
        buildCloudEnvironmentKey({
          platform: platform!,
          accountId: ACCOUNT,
          region: REGION,
        }),
      ).toBe(key);
    }
  });

  test("the platforms are App Platforms' own AWS ones, never a function's or a host's", () => {
    expect(AWS_LOG_GROUP_PLATFORMS).toEqual([
      ManagedCloudPlatform.AwsAppRunner,
      ManagedCloudPlatform.AwsElasticBeanstalk,
      ManagedCloudPlatform.AwsEcs,
    ]);

    for (const platform of AWS_LOG_GROUP_PLATFORMS) {
      expect(isManagedCloudPlatform(platform)).toBe(true);
      expect(getCloudProviderForPlatform(platform)).toBe(CloudProvider.AWS);
      expect(getManagedCloudPlatformDescriptor(platform)).not.toBeNull();
    }
  });

  test("the ECS task family is the attribute an ECS app is named by, and the cluster ARN what keeps two apart", () => {
    const ecs: ReturnType<typeof getManagedCloudPlatformDescriptor> =
      getManagedCloudPlatformDescriptor(ManagedCloudPlatform.AwsEcs)!;

    expect(ecs.appAttributes[0]).toBe(ECS_TASK_FAMILY_ATTRIBUTE);
    expect(ecs.appGroupAttributes).toEqual([ECS_CLUSTER_ARN_ATTRIBUTE]);
    expect(
      AWS_LOG_GROUP_ENVIRONMENT_RULES.map(
        (rule: (typeof AWS_LOG_GROUP_ENVIRONMENT_RULES)[number]): string => {
          return rule.prefix;
        },
      ),
    ).toEqual(["/ecs/"]);
  });

  test("a function, a database or a state machine is no App Platforms resource: no platform of App Platforms", () => {
    expect(
      fromLogs("/aws/lambda/checkout").attributes[CLOUD_PLATFORM_ATTRIBUTE],
    ).toBe("aws_lambda");
    expect(
      isManagedCloudPlatform(
        fromLogs("/aws/lambda/checkout").attributes[CLOUD_PLATFORM_ATTRIBUTE],
      ),
    ).toBe(false);

    for (const logGroup of [
      "/aws/rds/instance/orders-db/postgresql",
      "/aws/rds/cluster/orders-aurora/slowquery",
      "/aws/vendedlogs/states/order-flow-Logs",
      "/aws/OpenSearchService/domains/search/application-logs",
    ]) {
      expect({
        logGroup,
        platform: fromLogs(logGroup).attributes[CLOUD_PLATFORM_ATTRIBUTE],
      }).toEqual({ logGroup, platform: undefined });
    }
  });

  test("outside an AWS Region a resource keeps its id but gets no platform: no environment with a part of its key missing", () => {
    for (const region of ["", "europe", "us_east_1"]) {
      const attributes: Record<string, string> = getAwsLogGroupAttributes({
        logGroup:
          "/aws/elasticbeanstalk/storefront-prod/var/log/web.stdout.log",
        accountId: ACCOUNT,
        region,
      });

      expect({
        region,
        platform: attributes[CLOUD_PLATFORM_ATTRIBUTE],
      }).toEqual({ region, platform: undefined });
      expect(attributes[CLOUD_RESOURCE_ID_ATTRIBUTE]).toEqual(
        expect.any(String),
      );
      expect(
        getAwsLogGroupEnvironmentAttributes({
          logGroup: "/ecs/storefront-web",
          accountId: ACCOUNT,
          region,
        }),
      ).toBeNull();
    }
  });

  test("an ECS task's group of no account is no environment's", () => {
    expect(
      getAwsLogGroupEnvironmentAttributes({
        logGroup: "/ecs/storefront-web",
        accountId: "",
        region: REGION,
      }),
    ).toBeNull();
    expect(
      getAwsLogGroupAttributes({
        logGroup: "/ecs/storefront-web",
        accountId: "",
        region: REGION,
      }),
    ).toEqual({});
  });

  test("a family of 255 characters, the most ECS allows, is read; a longer one is not", () => {
    const longest: string = "f".repeat(TASK_DEFINITION_FAMILY_MAX_LENGTH);

    expect(TASK_DEFINITION_FAMILY_MAX_LENGTH).toBe(255);
    expect(
      getAwsLogGroupEnvironmentAttributes({
        logGroup: `/ecs/${longest}`,
        accountId: ACCOUNT,
        region: REGION,
      }),
    ).toEqual({
      [CLOUD_PLATFORM_ATTRIBUTE]: "aws_ecs",
      [ECS_TASK_FAMILY_ATTRIBUTE]: longest,
    });
    expect(
      getAwsLogGroupEnvironmentAttributes({
        logGroup: `/ecs/${longest}f`,
        accountId: ACCOUNT,
        region: REGION,
      }),
    ).toBeNull();
  });

  test.each([
    // The prefix alone, a group under a family, or names no family can have.
    "/ecs/",
    "/ecs/storefront/web",
    "/ecs/storefront/",
    "/ecs/store.front",
    "/ecs/store front",
    "/ecs/storefront#1",
    // Not the ECS console's spelling, or another service's group.
    "/ECS/storefront",
    "ecs/storefront",
    "/aws/ecs/storefront",
    "/my-team/ecs/storefront",
  ])("%s is no ECS task's group", (logGroup: string) => {
    expect(
      getAwsLogGroupEnvironmentAttributes({
        logGroup,
        accountId: ACCOUNT,
        region: REGION,
      }),
    ).toBeNull();
    expect(
      getAwsLogGroupAttributes({
        logGroup,
        accountId: ACCOUNT,
        region: REGION,
      })[CLOUD_PLATFORM_ATTRIBUTE],
    ).toBeUndefined();
  });

  test.each([
    "/my-team/app",
    "API-Gateway-Execution-Logs_a1b2c3d4e5/prod",
    "vpc-flow-logs",
    "",
  ])(
    "%s, which no rule reads, carries nothing beside the connection's own",
    (logGroup: string) => {
      expect(
        getAwsLogGroupAttributes({
          logGroup,
          accountId: ACCOUNT,
          region: REGION,
        }),
      ).toEqual({});
    },
  );

  test("a name longer than CloudWatch Logs allows is read by neither kind of rule", () => {
    expect(
      getAwsLogGroupAttributes({
        logGroup: `/ecs/${"x".repeat(520)}`,
        accountId: ACCOUNT,
        region: REGION,
      }),
    ).toEqual({});
  });
});
