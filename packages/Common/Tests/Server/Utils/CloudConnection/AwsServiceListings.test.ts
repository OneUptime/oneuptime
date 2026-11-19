import { describe, expect, test } from "@jest/globals";
import AwsCloudConnector from "../../../../Server/Utils/CloudConnection/Aws/AwsCloudConnector";
import {
  CloudCompleteListing,
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
  resolveCloudMonitoredResource,
} from "../../../../Types/Cloud/CloudMonitoredResource";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import {
  AWS_READ_ONLY_ACTIONS,
  getAwsReadOnlyPolicyDocument,
  isAwsActionGranted,
} from "../../../../Types/CloudConnection/CloudConnectionSetupCommands";
import { JSONObject } from "../../../../Types/JSON";
import {
  FAKE_ACCOUNT_ID,
  FakeAws,
  FakeRegion,
  awsError,
  createFakeAws,
} from "./FakeAwsApi";

/*
 * #9692: the types read since #9567 are listed before they report a
 * metric. WAF web ACLs, Network Firewall firewalls, Global Accelerator
 * accelerators, Cognito user pools, AppSync GraphQL APIs and SageMaker
 * endpoints are listed with each service's own API (AwsServiceListings),
 * each as the very row its metrics name; a role set up before may not list
 * them, and is read as before, without a warning, nothing archived.
 */

const REGION: string = "eu-west-1";
const NOW: Date = new Date("2026-11-19T12:07:00Z");
const connector: AwsCloudConnector = new AwsCloudConnector();

const WAF_ARN: string = `arn:aws:wafv2:${REGION}:${FAKE_ACCOUNT_ID}:regional/webacl/edge/a1b2c3d4`;
const FIREWALL_ARN: string = `arn:aws:network-firewall:${REGION}:${FAKE_ACCOUNT_ID}:firewall/egress`;
const ACCELERATOR_ARN: string = `arn:aws:globalaccelerator::${FAKE_ACCOUNT_ID}:accelerator/1234abcd-abcd-1234-abcd-1234abcdefgh`;
const APPSYNC_ARN: string = `arn:aws:appsync:${REGION}:${FAKE_ACCOUNT_ID}:apis/abcdefghijklmnopqrstuvwxyz`;
const ENDPOINT_ARN: string = `arn:aws:sagemaker:${REGION}:${FAKE_ACCOUNT_ID}:endpoint/recommender-prod`;

function settings(): CloudConnectionSettings {
  return {
    provider: CloudProvider.AWS,
    projectId: "11111111-1111-4111-8111-111111111111",
    config: {
      authMethod: CloudConnectionAuthMethod.AwsAccessKey,
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      regions: REGION,
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

// A Region of each type's one resource.
function everyType(extra: Partial<FakeRegion> = {}): FakeRegion {
  return {
    metrics: [],
    wafWebAcls: [
      {
        Name: "edge",
        Id: "a1b2c3d4",
        ARN: WAF_ARN,
        MetricName: "edgeMetrics",
      },
    ],
    networkFirewalls: [{ FirewallName: "egress", FirewallArn: FIREWALL_ARN }],
    userPools: [{ Id: `${REGION}_AbCdEfGhI`, Name: "customers" }],
    appSyncApis: [
      {
        apiId: "abcdefghijklmnopqrstuvwxyz",
        name: "catalog",
        arn: APPSYNC_ARN,
        uris: {
          GRAPHQL:
            "https://abcdefghijklmnopqrstuvwxyz.appsync-api.eu-west-1.amazonaws.com/graphql",
        },
      },
    ],
    sageMakerEndpoints: [
      {
        EndpointName: "Recommender-Prod",
        EndpointArn: ENDPOINT_ARN,
        EndpointStatus: "InService",
      },
    ],
    ...extra,
  };
}

// The identity a CloudWatch datapoint of these dimensions gives, in its Region.
function fromMetrics(
  namespace: string,
  dimensions: Record<string, string>,
  region: string = REGION,
): CloudMonitoredResource | null {
  const attributes: Record<string, string> = {
    [AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE]: namespace,
    [CLOUD_ACCOUNT_ID_ATTRIBUTE]: FAKE_ACCOUNT_ID,
    [CLOUD_REGION_ATTRIBUTE]: region,
  };

  for (const [name, value] of Object.entries(dimensions)) {
    attributes[`${AWS_CLOUDWATCH_DIMENSION_PREFIX}${name}`] = value;
  }

  return resolveCloudMonitoredResource({
    metricName: `${AWS_CLOUDWATCH_METRIC_NAME_PREFIX}${namespace}/Metric`,
    attributes,
  });
}

function itemOf(
  result: CloudInventoryResult,
  resourceType: string,
): CloudInventoryItem | undefined {
  return result.items.find((entry: CloudInventoryItem): boolean => {
    return entry.resource.resourceType === resourceType;
  });
}

describe("the types read since #9567, listed before they report a metric", () => {
  test("each is listed by its service's own API, as the row its metrics name", async () => {
    const fake: FakeAws = createFakeAws({
      regions: { [REGION]: everyType(), "us-east-1": { metrics: [] } },
      accelerators: [
        { AcceleratorArn: ACCELERATOR_ARN, Name: "edge", Status: "DEPLOYED" },
      ],
    });
    const result: CloudInventoryResult = await connector.readInventory!(
      settings(),
      options(fake),
    );

    for (const [type, namespace, dimensions, region, name] of [
      [
        "AWS::WAFv2::WebACL",
        "AWS/WAFV2",
        // Its metrics name it by its metric name, not its name.
        { WebACL: "edgeMetrics", Rule: "ALL" },
        REGION,
        "edge",
      ],
      [
        "AWS::NetworkFirewall::Firewall",
        "AWS/NetworkFirewall",
        { FirewallName: "egress" },
        REGION,
        "egress",
      ],
      [
        "AWS::Cognito::UserPool",
        "AWS/Cognito",
        { UserPool: `${REGION}_AbCdEfGhI`, UserPoolClient: "web" },
        REGION,
        "customers",
      ],
      [
        "AWS::AppSync::GraphQLApi",
        "AWS/AppSync",
        { GraphQLAPIId: "abcdefghijklmnopqrstuvwxyz" },
        REGION,
        "catalog",
      ],
      [
        "AWS::SageMaker::Endpoint",
        "AWS/SageMaker",
        { EndpointName: "Recommender-Prod", VariantName: "AllTraffic" },
        REGION,
        "Recommender-Prod",
      ],
      [
        // Global Accelerator's metrics are US West (Oregon)'s, whatever Region lists it.
        "AWS::GlobalAccelerator::Accelerator",
        "AWS/GlobalAccelerator",
        { Accelerator: "1234abcd-abcd-1234-abcd-1234abcdefgh" },
        "us-west-2",
        "edge",
      ],
    ] as Array<[string, string, Record<string, string>, string, string]>) {
      const item: CloudInventoryItem | undefined = itemOf(result, type);
      const metricsRow: CloudMonitoredResource | null = fromMetrics(
        namespace,
        dimensions,
        region,
      );

      expect({ type, listed: Boolean(item) }).toEqual({ type, listed: true });
      expect(item!.resource.identityKey).toBe(metricsRow!.identityKey);
      expect(item!.displayName).toBe(name);
    }

    // Each listed in full: one of them gone may be archived.
    const listedInFull: Array<string> = result.completelyListed.flatMap(
      (entry: { resourceTypes: Array<string> }): Array<string> => {
        return entry.resourceTypes;
      },
    );

    for (const type of [
      "AWS::WAFv2::WebACL",
      "AWS::NetworkFirewall::Firewall",
      "AWS::Cognito::UserPool",
      "AWS::AppSync::GraphQLApi",
      "AWS::SageMaker::Endpoint",
      "AWS::GlobalAccelerator::Accelerator",
    ]) {
      expect({ type, inFull: listedInFull.includes(type) }).toEqual({
        type,
        inFull: true,
      });
    }

    expect(result.warnings).toEqual([]);
  });

  test("each call is the service's own list, its paging asked as each service asks it", async () => {
    const fake: FakeAws = createFakeAws({
      regions: { [REGION]: everyType(), "us-east-1": { metrics: [] } },
      accelerators: [],
    });

    await connector.readInventory!(settings(), options(fake));

    const calls: Record<
      string,
      Array<{ region: string; body: JSONObject }>
    > = {};

    for (const call of fake.listingCalls) {
      calls[call.action] = [
        ...(calls[call.action] || []),
        { region: call.region, body: call.body },
      ];
    }

    expect(calls["wafv2:ListWebACLs"]).toEqual([
      { region: REGION, body: { Scope: "REGIONAL", Limit: 100 } },
      { region: "us-east-1", body: { Scope: "REGIONAL", Limit: 100 } },
      // A CloudFront distribution's web ACLs, in US East (N. Virginia) alone.
      { region: "us-east-1", body: { Scope: "CLOUDFRONT", Limit: 100 } },
    ]);
    // Its metric name, which ListWebACLs does not answer.
    expect(calls["wafv2:GetWebACL"]).toEqual([
      {
        region: REGION,
        body: { Name: "edge", Scope: "REGIONAL", Id: "a1b2c3d4" },
      },
    ]);
    expect(calls["network-firewall:ListFirewalls"]?.[0]).toEqual({
      region: REGION,
      body: { MaxResults: 100 },
    });
    // Cognito takes 60 a page at most, and must be told.
    expect(calls["cognito-idp:ListUserPools"]?.[0]).toEqual({
      region: REGION,
      body: { MaxResults: 60 },
    });
    expect(calls["appsync:ListGraphqlApis"]?.[0]).toEqual({
      region: REGION,
      body: { maxResults: "25" },
    });
    expect(calls["sagemaker:ListEndpoints"]?.[0]).toEqual({
      region: REGION,
      body: { MaxResults: 100 },
    });
    // Once, from US West (Oregon): not once a Region.
    expect(calls["globalaccelerator:ListAccelerators"]).toEqual([
      { region: "us-west-2", body: { MaxResults: 100 } },
    ]);
  });

  test("a role set up before they were listed is refused quietly: no warning, nothing archived, the rest listed", async () => {
    const refused: (action: string) => ReturnType<typeof awsError> = (
      action: string,
    ) => {
      return awsError(
        403,
        "AccessDeniedException",
        `User: arn:aws:iam::${FAKE_ACCOUNT_ID}:user/OneUptimeReadOnly is not authorized to perform: ${action}`,
      );
    };
    const fake: FakeAws = createFakeAws({
      regions: {
        [REGION]: everyType({
          listingErrors: {
            "wafv2:ListWebACLs": refused("wafv2:ListWebACLs"),
            "network-firewall:ListFirewalls": refused(
              "network-firewall:ListFirewalls",
            ),
            "cognito-idp:ListUserPools": refused("cognito-idp:ListUserPools"),
            "appsync:ListGraphqlApis": refused("appsync:ListGraphqlApis"),
            "sagemaker:ListEndpoints": refused("sagemaker:ListEndpoints"),
          },
        }),
        "us-east-1": { metrics: [] },
      },
      acceleratorsError: refused("globalaccelerator:ListAccelerators"),
    });
    const result: CloudInventoryResult = await connector.readInventory!(
      settings(),
      options(fake),
    );
    /*
     * What the refusing Region listed in full - a listing of no Regions is
     * every Region's - and the accelerators wherever they were.
     */
    const listedInFull: Array<string> = result.completelyListed.flatMap(
      (entry: CloudCompleteListing): Array<string> => {
        return entry.resourceTypes.filter((type: string): boolean => {
          return (
            !entry.regions ||
            entry.regions.includes(REGION) ||
            type === "AWS::GlobalAccelerator::Accelerator"
          );
        });
      },
    );

    // The Region's other types were listed in full: the check below is not empty.
    expect(listedInFull).toContain("AWS::EC2::Instance");

    expect(result.warnings).toEqual([]);

    for (const type of [
      "AWS::WAFv2::WebACL",
      "AWS::NetworkFirewall::Firewall",
      "AWS::Cognito::UserPool",
      "AWS::AppSync::GraphQLApi",
      "AWS::SageMaker::Endpoint",
      "AWS::GlobalAccelerator::Accelerator",
    ]) {
      expect({ type, listed: Boolean(itemOf(result, type)) }).toEqual({
        type,
        listed: false,
      });
      // Not listed in full: nothing of it the connection holds is taken for gone.
      expect({ type, inFull: listedInFull.includes(type) }).toEqual({
        type,
        inFull: false,
      });
    }
  });

  test("a GovCloud connection asks nothing of Global Accelerator, which is the commercial partition's", async () => {
    const fake: FakeAws = createFakeAws({
      regions: { "us-gov-west-1": { metrics: [] } },
      accelerators: [{ AcceleratorArn: ACCELERATOR_ARN, Name: "edge" }],
    });

    await connector.readInventory!(
      {
        ...settings(),
        config: { ...settings().config, regions: "us-gov-west-1" },
      },
      options(fake),
    );

    expect(
      fake.listingCalls.filter((call: { action: string }): boolean => {
        return call.action === "globalaccelerator:ListAccelerators";
      }),
    ).toEqual([]);
    // Nor of WAF's CloudFront scope.
    expect(
      fake.listingCalls.filter((call: { body: JSONObject }): boolean => {
        return call.body["Scope"] === "CLOUDFRONT";
      }),
    ).toEqual([]);
  });

  test("the setup command grants each list, and the access key's inline policy stays within IAM's 2,048 characters", () => {
    for (const action of [
      "wafv2:ListWebACLs",
      "wafv2:GetWebACL",
      "network-firewall:ListFirewalls",
      "globalaccelerator:ListAccelerators",
      "cognito-idp:ListUserPools",
      "appsync:ListGraphqlApis",
      "sagemaker:ListEndpoints",
    ]) {
      expect({ action, granted: isAwsActionGranted(action) }).toEqual({
        action,
        granted: true,
      });
      expect(AWS_READ_ONLY_ACTIONS).toContain(action);
    }

    expect(getAwsReadOnlyPolicyDocument().length).toBeLessThanOrEqual(2048);
  });
});
