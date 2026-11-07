import { describe, expect, test } from "@jest/globals";
import AwsCloudConnector from "../../../../Server/Utils/CloudConnection/Aws/AwsCloudConnector";
import {
  AWS_INVENTORY_TYPES,
  AwsInventoryContext,
  AwsInventoryType,
  buildAwsInventoryItem,
  getAppRunnerServiceId,
  getAwsInventoryIdentity,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsInventoryCatalog";
import { readBeanstalkEnvironment } from "../../../../Server/Utils/CloudConnection/Aws/AwsBeanstalkEnvironments";
import { AwsListedResource } from "../../../../Server/Utils/CloudConnection/Aws/AwsCloudControl";
import { parseAwsXml } from "../../../../Server/Utils/CloudConnection/LiveRead/AwsXml";
import {
  CloudConnectionPullState,
  CloudConnectionSettings,
  CloudInventoryItem,
  CloudInventoryResult,
  CloudReadBudget,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import {
  AWS_CLOUDWATCH_DIMENSION_PREFIX,
  AWS_CLOUDWATCH_METRIC_NAME_PREFIX,
  AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE,
  CLOUD_ACCOUNT_ID_ATTRIBUTE,
  CLOUD_REGION_ATTRIBUTE,
  CloudMonitoredResource,
  isCloudProviderOwnResourceId,
  resolveCloudMonitoredResource,
} from "../../../../Types/Cloud/CloudMonitoredResource";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { AWS_READ_ONLY_ACTIONS } from "../../../../Types/CloudConnection/CloudConnectionSetupCommands";
import { JSONObject } from "../../../../Types/JSON";
import {
  CloudResourceParse,
  parseCloudResourceId,
} from "../../../../Utils/AiRemediation/Resource/CloudOperationCatalog";
import {
  FAKE_ACCOUNT_ID,
  FakeAws,
  awsError,
  createFakeAws,
} from "./FakeAwsApi";

/*
 * Contract under test - what lets OneUptime AI change an environment App
 * Platforms shows on AWS: its resource in the account's inventory, named
 * by the ARN a change of the cloud catalog takes.
 *
 *  - an App Runner service is named by its ARN once the inventory lists
 *    it, the same row its metrics name, whether or not a metric carries
 *    the service's id;
 *  - Elastic Beanstalk environments are listed by Elastic Beanstalk itself
 *    (DescribeEnvironments), each named by its ARN, which only that list
 *    knows: Cloud Control names an environment by its name alone;
 *  - a connection whose role may not read them yet lists everything else as
 *    before, with no warning, and nothing of them is archived;
 *  - a provider's own id is told apart from a stand-in, which never
 *    replaces it.
 */

const REGION: string = "us-east-1";
const APP_RUNNER_ARN: string = `arn:aws:apprunner:${REGION}:${FAKE_ACCOUNT_ID}:service/checkout-web/8fe1e10304f84fd2b0df550fe98a71fa`;
const BEANSTALK_ARN: string = `arn:aws:elasticbeanstalk:${REGION}:${FAKE_ACCOUNT_ID}:environment/shop/shop-prod`;
const NOW: Date = new Date("2026-11-06T12:07:00Z");

const context: AwsInventoryContext = {
  accountId: FAKE_ACCOUNT_ID,
  region: REGION,
};

const connector: AwsCloudConnector = new AwsCloudConnector();

function type(name: string): AwsInventoryType {
  const found: AwsInventoryType | undefined = AWS_INVENTORY_TYPES.find(
    (candidate: AwsInventoryType): boolean => {
      return candidate.type === name;
    },
  );

  if (!found) {
    throw new Error(`no inventory type ${name}`);
  }

  return found;
}

function listed(identifier: string, properties: JSONObject): AwsListedResource {
  return { identifier, properties };
}

// The identity a CloudWatch datapoint with these dimensions gives.
function fromMetrics(
  namespace: string,
  dimensions: Record<string, string>,
): CloudMonitoredResource | null {
  const attributes: Record<string, string> = {
    [AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE]: namespace,
    [CLOUD_ACCOUNT_ID_ATTRIBUTE]: FAKE_ACCOUNT_ID,
    [CLOUD_REGION_ATTRIBUTE]: REGION,
  };

  for (const [name, value] of Object.entries(dimensions)) {
    attributes[`${AWS_CLOUDWATCH_DIMENSION_PREFIX}${name}`] = value;
  }

  return resolveCloudMonitoredResource({
    metricName: `${AWS_CLOUDWATCH_METRIC_NAME_PREFIX}${namespace}/Requests`,
    attributes,
  });
}

function settings(): CloudConnectionSettings {
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

function options(
  fake: FakeAws,
  state: CloudConnectionPullState = { accounts: [FAKE_ACCOUNT_ID] },
): Parameters<NonNullable<AwsCloudConnector["readInventory"]>>[1] {
  return {
    transport: fake.transport,
    now: () => {
      return NOW;
    },
    sleep: async () => {},
    state,
    connectionId: "33333333-3333-4333-8333-333333333333",
    budget: new CloudReadBudget({ maxRequests: 1500, maxDurationMs: 60000 }),
  };
}

function item(
  result: CloudInventoryResult,
  resourceType: string,
): CloudInventoryItem | undefined {
  return result.items.find((entry: CloudInventoryItem): boolean => {
    return entry.resource.resourceType === resourceType;
  });
}

describe("an App Runner service is named by its ARN", () => {
  test("the inventory lists it by the ARN a change takes, as one row with its metrics", () => {
    const fromInventory: CloudMonitoredResource | null =
      getAwsInventoryIdentity(
        type("AWS::AppRunner::Service"),
        listed(APP_RUNNER_ARN, {
          ServiceName: "checkout-web",
          ServiceArn: APP_RUNNER_ARN,
        }),
        context,
      );
    // A metric with the service's name alone: the same row, a stand-in id.
    const nameOnly: CloudMonitoredResource | null = fromMetrics(
      "AWS/AppRunner",
      { ServiceName: "checkout-web" },
    );
    const withId: CloudMonitoredResource | null = fromMetrics("AWS/AppRunner", {
      ServiceName: "checkout-web",
      ServiceID: "8fe1e10304f84fd2b0df550fe98a71fa",
    });

    expect(fromInventory?.providerResourceId).toBe(APP_RUNNER_ARN);
    expect(withId?.providerResourceId).toBe(APP_RUNNER_ARN);
    expect(nameOnly?.providerResourceId).toBe(
      "AWS/AppRunner ServiceName=checkout-web",
    );
    expect(fromInventory?.identityKey).toBe(nameOnly?.identityKey);
    expect(fromInventory?.identityKey).toBe(withId?.identityKey);

    const parsed: CloudResourceParse = parseCloudResourceId(
      "aws",
      fromInventory!.providerResourceId,
    );

    expect(parsed.ok && parsed.resource.kind).toBe("apprunner-service");
  });

  test("the service's id is read from its ARN, or its own ServiceId, and never made up", () => {
    expect(getAppRunnerServiceId(APP_RUNNER_ARN)).toBe(
      "8fe1e10304f84fd2b0df550fe98a71fa",
    );
    expect(getAppRunnerServiceId("8fe1e10304f84fd2b0df550fe98a71fa")).toBe(
      "8fe1e10304f84fd2b0df550fe98a71fa",
    );

    for (const value of [
      "",
      "arn:aws:apprunner:us-east-1:123456789012:service/checkout-web",
      "arn:aws:apprunner:us-east-1:123456789012:service/checkout-web/abc",
      "8FE1E10304F84FD2B0DF550FE98A71FA",
    ]) {
      expect([value, getAppRunnerServiceId(value)]).toEqual([value, ""]);
    }

    // No id to read: the service is still listed, by its stand-in id.
    expect(
      getAwsInventoryIdentity(
        type("AWS::AppRunner::Service"),
        listed("checkout-web", { ServiceName: "checkout-web" }),
        context,
      )?.providerResourceId,
    ).toBe("AWS/AppRunner ServiceName=checkout-web");
  });
});

describe("Elastic Beanstalk environments are listed by Elastic Beanstalk", () => {
  test("each environment is named by its ARN, with what the inventory keeps of it", () => {
    const environment: AwsListedResource | null = readBeanstalkEnvironment(
      parseAwsXml(
        `<member><EnvironmentName>shop-prod</EnvironmentName><EnvironmentId>e-abcd1234ef</EnvironmentId><ApplicationName>shop</ApplicationName><EnvironmentArn>${BEANSTALK_ARN}</EnvironmentArn><VersionLabel>v42</VersionLabel><Status>Ready</Status><Health>Red</Health><HealthStatus>Severe</HealthStatus><CNAME>shop-prod.eba-x1.us-east-1.elasticbeanstalk.com</CNAME><Tier><Name>WebServer</Name><Type>Standard</Type></Tier></member>`,
      ),
    );

    expect(environment).toEqual({
      identifier: BEANSTALK_ARN,
      properties: {
        EnvironmentName: "shop-prod",
        EnvironmentId: "e-abcd1234ef",
        ApplicationName: "shop",
        EnvironmentArn: BEANSTALK_ARN,
        VersionLabel: "v42",
        Status: "Ready",
        Health: "Red",
        HealthStatus: "Severe",
        CNAME: "shop-prod.eba-x1.us-east-1.elasticbeanstalk.com",
        Tier: { Name: "WebServer" },
      },
    });

    const built: CloudInventoryItem | null = buildAwsInventoryItem(
      type("AWS::ElasticBeanstalk::Environment"),
      environment!,
      context,
    );

    expect(built?.resource.providerResourceId).toBe(BEANSTALK_ARN);
    expect(built?.displayName).toBe("shop-prod");
    expect(built?.endpoints).toEqual([
      "shop-prod.eba-x1.us-east-1.elasticbeanstalk.com",
    ]);
    expect(built?.properties).toEqual({
      ApplicationName: "shop",
      EnvironmentId: "e-abcd1234ef",
      VersionLabel: "v42",
      Status: "Ready",
      Health: "Red",
      HealthStatus: "Severe",
      "Tier.Name": "WebServer",
    });
    // The same row its metrics name, which carry the environment's name alone.
    expect(built?.resource.identityKey).toBe(
      fromMetrics("AWS/ElasticBeanstalk", { EnvironmentName: "shop-prod" })
        ?.identityKey,
    );

    const parsed: CloudResourceParse = parseCloudResourceId(
      "aws",
      built!.resource.providerResourceId,
    );

    expect(parsed.ok && parsed.resource.kind).toBe("beanstalk-environment");
  });

  test("an environment the answer gives no ARN is left out", () => {
    expect(
      readBeanstalkEnvironment(
        parseAwsXml(
          "<member><EnvironmentName>shop-prod</EnvironmentName></member>",
        ),
      ),
    ).toBeNull();
  });

  test("the inventory reads DescribeEnvironments in every Region, page by page, and lists each environment", async () => {
    const environments: Array<JSONObject> = [];

    // 1,001 environments: two pages of DescribeEnvironments' 1,000.
    for (let index: number = 0; index < 1001; index++) {
      const name: string = `shop-env-${String(index).padStart(4, "0")}`;

      environments.push({
        EnvironmentName: name,
        ApplicationName: "shop",
        EnvironmentArn: `arn:aws:elasticbeanstalk:${REGION}:${FAKE_ACCOUNT_ID}:environment/shop/${name}`,
        Status: "Ready",
      });
    }

    const fake: FakeAws = createFakeAws({
      regions: {
        [REGION]: { metrics: [], beanstalkEnvironments: environments },
      },
    });
    const result: CloudInventoryResult = await connector.readInventory!(
      settings(),
      options(fake),
    );
    const listedEnvironments: Array<CloudInventoryItem> = result.items.filter(
      (entry: CloudInventoryItem): boolean => {
        return (
          entry.resource.resourceType === "AWS::ElasticBeanstalk::Environment"
        );
      },
    );

    expect(listedEnvironments).toHaveLength(1001);
    expect(listedEnvironments[0]?.resource.providerResourceId).toBe(
      `arn:aws:elasticbeanstalk:${REGION}:${FAKE_ACCOUNT_ID}:environment/shop/shop-env-0000`,
    );
    expect(
      fake.beanstalkCalls.map(
        (call: { params: Record<string, string> }): Record<string, string> => {
          return call.params;
        },
      ),
    ).toEqual([
      {
        Action: "DescribeEnvironments",
        Version: "2010-12-01",
        IncludeDeleted: "false",
        MaxRecords: "1000",
      },
      {
        Action: "DescribeEnvironments",
        Version: "2010-12-01",
        IncludeDeleted: "false",
        MaxRecords: "1000",
        NextToken: "1000",
      },
    ]);
    // Listed in full: a gone environment may be archived.
    expect(result.completelyListed[0]?.resourceTypes).toContain(
      "AWS::ElasticBeanstalk::Environment",
    );
    expect(result.warnings).toEqual([]);
  });

  test("a role set up before environments were listed is refused quietly: no warning, nothing archived, the rest listed", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {
        [REGION]: {
          metrics: [],
          beanstalkError: awsError(
            403,
            "AccessDenied",
            "User: arn:aws:sts::123456789012:assumed-role/OneUptimeReadOnly/s is not authorized to perform: elasticbeanstalk:DescribeEnvironments",
          ),
          resources: {
            "AWS::AppRunner::Service": [
              {
                Identifier: APP_RUNNER_ARN,
                Properties: {
                  ServiceName: "checkout-web",
                  ServiceArn: APP_RUNNER_ARN,
                },
              },
            ],
          },
        },
      },
    });
    const result: CloudInventoryResult = await connector.readInventory!(
      settings(),
      options(fake),
    );

    expect(result.warnings).toEqual([]);
    expect(result.completelyListed[0]?.resourceTypes).not.toContain(
      "AWS::ElasticBeanstalk::Environment",
    );
    expect(result.completelyListed[0]?.resourceTypes).toContain(
      "AWS::AppRunner::Service",
    );
    expect(
      item(result, "AWS::AppRunner::Service")?.resource.providerResourceId,
    ).toBe(APP_RUNNER_ARN);
  });

  test("any other failure to list them is said, as for every type", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {
        [REGION]: {
          metrics: [],
          beanstalkError: awsError(500, "InternalFailure", "try again"),
        },
      },
    });
    const result: CloudInventoryResult = await connector.readInventory!(
      settings(),
      options(fake),
    );

    expect(
      result.warnings.filter((warning: string): boolean => {
        return warning.startsWith(
          `Could not list AWS::ElasticBeanstalk::Environment in ${REGION}:`,
        );
      }),
    ).toHaveLength(1);
    expect(result.completelyListed[0]?.resourceTypes).not.toContain(
      "AWS::ElasticBeanstalk::Environment",
    );
  });

  test("the connection's role may read them: its setup command grants DescribeEnvironments", () => {
    expect(AWS_READ_ONLY_ACTIONS).toContain(
      "elasticbeanstalk:DescribeEnvironments",
    );
  });
});

describe("a provider's own id, and a stand-in", () => {
  test.each([
    [CloudProvider.AWS, APP_RUNNER_ARN, true],
    [CloudProvider.AWS, "AWS/AppRunner ServiceName=checkout-web", false],
    [CloudProvider.AWS, "/subscriptions/x/resourceGroups/y", false],
    [
      CloudProvider.Azure,
      "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/jobs/providers/Microsoft.ContainerInstance/containerGroups/nightly",
      true,
    ],
    [
      CloudProvider.Azure,
      "/SUBSCRIPTIONS/00000000-0000-0000-0000-000000000000/resourceGroups/jobs",
      true,
    ],
    [CloudProvider.Azure, "Microsoft.Web/sites web", false],
    [
      CloudProvider.GCP,
      "//appengine.googleapis.com/apps/shop-prod/services/default",
      true,
    ],
    [
      CloudProvider.GCP,
      "gae_app project_id=shop-prod module_id=default",
      false,
    ],
    [CloudProvider.GCP, "", false],
  ])("%s %s is its own: %s", (provider: string, id: string, own: boolean) => {
    expect(isCloudProviderOwnResourceId(provider, id)).toBe(own);
  });
});
