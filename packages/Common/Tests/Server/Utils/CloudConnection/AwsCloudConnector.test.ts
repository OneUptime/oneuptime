import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import AwsCloudConnector from "../../../../Server/Utils/CloudConnection/Aws/AwsCloudConnector";
import AwsRetry from "../../../../Server/Utils/CloudConnection/Aws/AwsRetry";
import { AssumedRoleCache } from "../../../../Server/Utils/CloudConnection/Aws/AwsSts";
import AwsServerIdentity from "../../../../Server/Utils/CloudConnection/Aws/AwsServerIdentity";
import { storedAttributesOf } from "../../../../Server/Utils/CloudConnection/CloudMetricPayload";
import {
  CloudConnectionPullState,
  CloudConnectionSettings,
  CloudDiscoveredResource,
  CloudReadResult,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import {
  CloudMonitoredResource,
  resolveCloudMonitoredResource,
} from "../../../../Types/Cloud/CloudMonitoredResource";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { CloudStreamMetricSource } from "../../../../Types/CloudConnection/CloudStream";
import {
  AwsStreamCoverage,
  getAwsStreamCoverage,
} from "../../../../Types/CloudConnection/CloudStreamStack";
import { getAwsExternalIdForProject } from "../../../../Types/CloudConnection/CloudConnectionSetupCommands";
import {
  CloudConnectionFailureKind,
  CloudConnectionTestResult,
} from "../../../../Types/CloudConnection/CloudConnectionTest";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import {
  CloudAddedMetric,
  CloudAddedMetricScope,
  getCloudAddedMetricKey,
} from "../../../../Types/Cloud/CloudAddedMetrics";
import { everythingSent } from "../LlmObservability/FakeProviderApi";
import {
  FAKE_ACCOUNT_ID,
  FakeAws,
  FakeMetric,
  awsError,
  createFakeAws,
  stsError,
} from "./FakeAwsApi";

/*
 * Amazon Web Services against a fake AWS: signing in with an access key or
 * an assumed role (this project's external id, always), the daily sweep of
 * every Region and the hourly one of the Regions in use, each key metric's
 * series - the resource's own aggregate, not its splits - read since the
 * last read, the Name tags, and every way AWS says no: a wrong key, a
 * missing permission, a Region not opted in, throttling, a Region that
 * fails part way, a read that runs out of budget.
 */

const PROJECT: string = "11111111-1111-4111-8111-111111111111";
const ACCESS_KEY_ID: string = "AKIAIOSFODNN7EXAMPLE";
const SECRET: string = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const ROLE_ARN: string =
  "arn:aws:iam::123456789012:role/OneUptimeReadOnly-5f3a9c1e";
// 12:07; the CloudWatch window ends ten minutes back, on five: 11:55.
const NOW: Date = new Date("2026-10-21T12:07:00Z");
const WINDOW_END_S: number = Date.UTC(2026, 9, 21, 11, 55) / 1000;
const WINDOW_START_S: number = WINDOW_END_S - 3600;

const connector: AwsCloudConnector = new AwsCloudConnector();

function keySettings(config: JSONObject = {}): CloudConnectionSettings {
  return {
    provider: CloudProvider.AWS,
    projectId: PROJECT,
    config: {
      authMethod: CloudConnectionAuthMethod.AwsAccessKey,
      accessKeyId: ACCESS_KEY_ID,
      ...config,
    },
    secrets: { secretAccessKey: SECRET },
  };
}

function roleSettings(): CloudConnectionSettings {
  return {
    provider: CloudProvider.AWS,
    projectId: PROJECT,
    config: {
      authMethod: CloudConnectionAuthMethod.AwsRole,
      roleArn: ROLE_ARN,
    },
    secrets: {},
  };
}

function ec2(
  instanceId: string,
  values: Array<number> = [],
): Array<FakeMetric> {
  return [
    {
      namespace: "AWS/EC2",
      metricName: "CPUUtilization",
      dimensions: [["InstanceId", instanceId]],
      values: values.map((value: number, index: number): [number, number] => {
        return [WINDOW_START_S + index * 300, value];
      }),
    },
    // A per-type aggregate: no resource of its own.
    {
      namespace: "AWS/EC2",
      metricName: "CPUUtilization",
      dimensions: [["InstanceType", "m5.large"]],
      values: [[WINDOW_START_S, 99]],
    },
    {
      namespace: "AWS/EC2",
      metricName: "NetworkIn",
      dimensions: [["InstanceId", instanceId]],
      values: [[WINDOW_START_S, 1024]],
    },
  ];
}

const ALB: string = "app/checkout/50dc6c495c0c9188";

function alb(): Array<FakeMetric> {
  return [
    {
      namespace: "AWS/ApplicationELB",
      metricName: "RequestCount",
      dimensions: [["LoadBalancer", ALB]],
      values: [[WINDOW_START_S, 120]],
    },
    // Per target group and per zone: splits of the same load balancer.
    {
      namespace: "AWS/ApplicationELB",
      metricName: "RequestCount",
      dimensions: [
        ["LoadBalancer", ALB],
        ["TargetGroup", "targetgroup/checkout-tg/73e2d6bc24d8a067"],
      ],
      values: [[WINDOW_START_S, 60]],
    },
    {
      namespace: "AWS/ApplicationELB",
      metricName: "RequestCount",
      dimensions: [
        ["LoadBalancer", ALB],
        ["AvailabilityZone", "us-east-1a"],
      ],
      values: [[WINDOW_START_S, 60]],
    },
  ];
}

function readOptions(
  fake: FakeAws,
  state: CloudConnectionPullState = {},
  overrides: Partial<{ maxRequests: number }> = {},
): Parameters<AwsCloudConnector["read"]>[1] {
  return {
    transport: fake.transport,
    now: () => {
      return NOW;
    },
    sleep: async () => {},
    state,
    serviceName: "Amazon Web Services",
    connectionId: "33333333-3333-4333-8333-333333333333",
    maxRequests: overrides.maxRequests ?? 3000,
    maxDurationMs: 60000,
  };
}

// Every datapoint's stored attributes, resolved the way the ingest does.
function resolvedFromPayloads(result: CloudReadResult): Array<{
  metricName: string;
  resource: CloudMonitoredResource;
  points: number;
  attributes: JSONObject;
}> {
  const found: Array<{
    metricName: string;
    resource: CloudMonitoredResource;
    points: number;
    attributes: JSONObject;
  }> = [];

  for (const payload of result.payloads) {
    for (const rm of payload["resourceMetrics"] as JSONArray) {
      const resourceAttributes: JSONArray = (
        (rm as JSONObject)["resource"] as JSONObject
      )["attributes"] as JSONArray;

      for (const sm of (rm as JSONObject)["scopeMetrics"] as JSONArray) {
        for (const metric of (sm as JSONObject)["metrics"] as JSONArray) {
          const metricObject: JSONObject = metric as JSONObject;
          const dataPoints: JSONArray = (metricObject["gauge"] as JSONObject)[
            "dataPoints"
          ] as JSONArray;

          for (const point of dataPoints) {
            const stored: JSONObject = storedAttributesOf(
              resourceAttributes as never,
              (point as JSONObject)["attributes"] as never,
            ) as JSONObject;
            const resource: CloudMonitoredResource | null =
              resolveCloudMonitoredResource({
                metricName: metricObject["name"],
                attributes: stored,
              });

            expect(resource).not.toBeNull();
            found.push({
              metricName: metricObject["name"] as string,
              resource: resource!,
              points: 1,
              attributes: stored,
            });
          }
        }
      }
    }
  }

  return found;
}

beforeEach(() => {
  delete process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"];
  delete process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"];
  AssumedRoleCache.clear();
  AwsServerIdentity.clearCache();
});

afterEach(() => {
  delete process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"];
  delete process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"];
  jest.restoreAllMocks();
});

function giveOneUptimeAnAwsIdentity(): void {
  process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"] = "AKIAONEUPTIMESERVER1";
  process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"] =
    "oneuptime-server-secret";
}

describe("validateSettings", () => {
  test("an access key and its secret are enough; Regions are optional", () => {
    expect(() => {
      connector.validateSettings(keySettings());
    }).not.toThrow();
    expect(() => {
      connector.validateSettings(
        keySettings({ regions: "us-east-1, eu-west-1" }),
      );
    }).not.toThrow();
  });

  test("a malformed access key, a missing secret or a wrong Region is a form error", () => {
    expect(() => {
      connector.validateSettings(keySettings({ accessKeyId: "nope" }));
    }).toThrow(BadDataException);
    expect(() => {
      connector.validateSettings({ ...keySettings(), secrets: {} });
    }).toThrow("Secret access key is required.");
    expect(() => {
      connector.validateSettings(keySettings({ regions: "us-east-1, mars-1" }));
    }).toThrow('"mars-1" is not an AWS Region');
  });

  test("a role needs a role ARN and this OneUptime's own AWS identity", () => {
    expect(() => {
      connector.validateSettings(roleSettings());
    }).toThrow("This OneUptime has no AWS identity");

    giveOneUptimeAnAwsIdentity();

    expect(() => {
      connector.validateSettings(roleSettings());
    }).not.toThrow();
    expect(() => {
      connector.validateSettings({
        ...roleSettings(),
        config: {
          authMethod: CloudConnectionAuthMethod.AwsRole,
          roleArn: "arn:aws:iam::123456789012:user/x",
        },
      });
    }).toThrow("Role ARN must be an IAM role ARN");
  });
});

describe("testConnection", () => {
  test("signs in, finds where resources are, and counts them by type and Region", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {
        "us-east-1": {
          metrics: [...ec2("i-0aaa"), ...ec2("i-0bbb"), ...alb()],
        },
        "eu-west-1": { metrics: ec2("i-0ccc") },
        "us-west-2": { metrics: [] },
      },
    });

    const result: CloudConnectionTestResult = await connector.testConnection(
      keySettings(),
      {
        transport: fake.transport,
        now: () => {
          return NOW;
        },
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        provider: CloudProvider.AWS,
        status: "pass",
        accounts: [FAKE_ACCOUNT_ID],
        resourceCount: 4,
        resourceTypes: [
          { type: "AWS::EC2::Instance", count: 3 },
          { type: "AWS::ElasticLoadBalancingV2::LoadBalancer", count: 1 },
        ],
        regions: [
          { region: "us-east-1", count: 3 },
          { region: "eu-west-1", count: 1 },
        ],
        isSample: true,
      }),
    );
    expect(result.message).toContain(FAKE_ACCOUNT_ID);
    // Nothing secret went anywhere but the signature.
    for (const request of fake.requests) {
      expect(everythingSent(request)).not.toContain(SECRET);
    }
  });

  test("signs every call with Signature Version 4 for its service and Region", async () => {
    const fake: FakeAws = createFakeAws({
      regions: { "us-east-1": { metrics: ec2("i-0aaa") } },
    });

    await connector.testConnection(keySettings({ regions: "us-east-1" }), {
      transport: fake.transport,
      now: () => {
        return NOW;
      },
    });

    const listMetrics: DataSourceHttpRequest = fake.requests.find(
      (request: DataSourceHttpRequest): boolean => {
        return (
          new URL(request.url).host === "monitoring.us-east-1.amazonaws.com"
        );
      },
    )!;
    const headers: Record<string, string> = listMetrics.headers as Record<
      string,
      string
    >;

    expect(headers["Authorization"]).toMatch(
      new RegExp(
        `^AWS4-HMAC-SHA256 Credential=${ACCESS_KEY_ID}/20261021/us-east-1/monitoring/aws4_request, SignedHeaders=`,
      ),
    );
    expect(headers["X-Amz-Date"]).toBe("20261021T120700Z");
    expect(headers["X-Amz-Target"]).toBe(
      "GraniteServiceVersion20100801.ListMetrics",
    );
    expect(headers["Content-Type"]).toBe("application/x-amz-json-1.0");
  });

  test("nothing reporting is a warning, not a failure", async () => {
    const fake: FakeAws = createFakeAws({
      regions: { "us-east-1": { metrics: [] } },
    });

    const result: CloudConnectionTestResult = await connector.testConnection(
      keySettings({ regions: "us-east-1" }),
      {
        transport: fake.transport,
        now: () => {
          return NOW;
        },
      },
    );

    expect(result.status).toBe("warn");
    expect(result.resourceCount).toBe(0);
  });

  test("a key AWS does not know fails as authentication, without the secret", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {},
      callerIdentityError: stsError(
        403,
        "InvalidClientTokenId",
        `The security token included in the request is invalid. ${SECRET}`,
      ),
    });

    const result: CloudConnectionTestResult = await connector.testConnection(
      keySettings(),
      {
        transport: fake.transport,
        now: () => {
          return NOW;
        },
      },
    );

    expect(result.status).toBe("fail");
    expect(result.failureKind).toBe(CloudConnectionFailureKind.Authentication);
    expect(result.message).not.toContain(SECRET);
  });

  test("a key that may not list metrics fails as a permission", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {
        "us-east-1": {
          metrics: [],
          error: awsError(
            400,
            "AccessDenied",
            "User is not authorized to perform: cloudwatch:ListMetrics",
          ),
        },
      },
    });

    const result: CloudConnectionTestResult = await connector.testConnection(
      keySettings({ regions: "us-east-1" }),
      {
        transport: fake.transport,
        now: () => {
          return NOW;
        },
      },
    );

    expect(result.status).toBe("fail");
    expect(result.failureKind).toBe(CloudConnectionFailureKind.Permission);
  });

  test("settings the form can fix are its answer, as a settings failure", async () => {
    const fake: FakeAws = createFakeAws({ regions: {} });

    const result: CloudConnectionTestResult = await connector.testConnection(
      keySettings({ regions: "nowhere" }),
      {
        transport: fake.transport,
        now: () => {
          return NOW;
        },
      },
    );

    expect(result.status).toBe("fail");
    expect(result.failureKind).toBe(CloudConnectionFailureKind.Settings);
    expect(fake.requests).toHaveLength(0);
  });

  test("a role is assumed with this OneUptime's identity and this project's external id", async () => {
    giveOneUptimeAnAwsIdentity();
    const fake: FakeAws = createFakeAws({
      regions: { "us-east-1": { metrics: ec2("i-0aaa") } },
    });

    const result: CloudConnectionTestResult = await connector.testConnection(
      {
        ...roleSettings(),
        config: { ...roleSettings().config, regions: "us-east-1" },
      },
      {
        transport: fake.transport,
        now: () => {
          return NOW;
        },
      },
    );

    expect(result.status).toBe("pass");

    const assume: { body: URLSearchParams; request: DataSourceHttpRequest } =
      fake.stsCalls.find((call: { action: string }): boolean => {
        return call.action === "AssumeRole";
      })!;

    expect(assume.body.get("RoleArn")).toBe(ROLE_ARN);
    expect(assume.body.get("ExternalId")).toBe(
      getAwsExternalIdForProject(PROJECT),
    );
    expect(assume.body.get("DurationSeconds")).toBe("3600");
    expect(
      (assume.request.headers as Record<string, string>)["Authorization"],
    ).toContain("Credential=AKIAONEUPTIMESERVER1/");

    // Every call after it is signed with the role's session.
    const listMetrics: DataSourceHttpRequest = fake.requests.find(
      (request: DataSourceHttpRequest): boolean => {
        return new URL(request.url).host.startsWith("monitoring.");
      },
    )!;
    const headers: Record<string, string> = listMetrics.headers as Record<
      string,
      string
    >;

    expect(headers["Authorization"]).toContain(
      "Credential=ASIAASSUMEDROLE00001/",
    );
    expect(headers["X-Amz-Security-Token"]).toBe("session-token-abc");
  });

  test("a role that does not trust OneUptime says how to fix it", async () => {
    giveOneUptimeAnAwsIdentity();
    const fake: FakeAws = createFakeAws({
      regions: {},
      assumeRoleError: stsError(
        403,
        "AccessDenied",
        "User: arn:aws:iam::999988887777:user/oneuptime is not authorized to perform: sts:AssumeRole",
      ),
    });

    const result: CloudConnectionTestResult = await connector.testConnection(
      roleSettings(),
      {
        transport: fake.transport,
        now: () => {
          return NOW;
        },
      },
    );

    expect(result.status).toBe("fail");
    expect(result.failureKind).toBe(CloudConnectionFailureKind.Permission);
    expect(result.message).toContain("run the setup command again");
  });
});

describe("read", () => {
  test("the first read sweeps every Region, skips the ones not opted in, and reads each resource's own aggregate", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {
        "us-east-1": {
          metrics: [...ec2("i-0aaa", [10, 20, 30]), ...alb()],
        },
        "eu-west-1": { metrics: [] },
      },
    });

    const result: CloudReadResult = await connector.read(
      keySettings(),
      readOptions(fake),
    );

    expect(result.complete).toBe(true);
    expect(result.accounts).toEqual([FAKE_ACCOUNT_ID]);
    expect(result.completelyListedAccounts).toEqual([]);
    expect(
      result.resources
        .map((entry: CloudDiscoveredResource): string => {
          return `${entry.resource.resourceType} ${entry.resource.name}`;
        })
        .sort(),
    ).toEqual([
      "AWS::EC2::Instance i-0aaa",
      "AWS::ElasticLoadBalancingV2::LoadBalancer checkout",
    ]);
    expect(result.nextState.activePairs!.sort()).toEqual([
      "us-east-1|AWS/ApplicationELB",
      "us-east-1|AWS/EC2",
    ]);
    expect(result.nextState.fullSweepAt).toBe(NOW.toISOString());
    expect(result.nextState.inventoryAt).toBe(NOW.toISOString());
    expect(result.nextState.cursors).toEqual({
      "300": new Date(WINDOW_END_S * 1000).toISOString(),
    });

    // Every datapoint lands on a resource the read found.
    const resolved: ReturnType<typeof resolvedFromPayloads> =
      resolvedFromPayloads(result);
    const identities: Set<string> = new Set(
      result.resources.map((entry: CloudDiscoveredResource): string => {
        return entry.resource.identityKey;
      }),
    );

    for (const entry of resolved) {
      expect(identities.has(entry.resource.identityKey)).toBe(true);
    }

    // CPU three times, NetworkIn once, the load balancer's own count once.
    expect(result.pointsWritten).toBe(5);
    expect(
      resolved
        .filter((entry: { metricName: string }): boolean => {
          return (
            entry.metricName === "amazonaws.com/AWS/ApplicationELB/RequestCount"
          );
        })
        .map((entry: { attributes: JSONObject }) => {
          return entry.attributes["Dimensions.TargetGroup"];
        }),
    ).toEqual([undefined]);

    // The receivers' resource attributes and the connection's.
    expect(resolved[0]!.attributes).toEqual(
      expect.objectContaining({
        "resource.cloud.provider": "aws",
        "resource.cloud.account.id": FAKE_ACCOUNT_ID,
        "resource.cloud.region": "us-east-1",
        "resource.service.name": "Amazon Web Services",
        "resource.oneuptime.cloud.connection.id":
          "33333333-3333-4333-8333-333333333333",
        Namespace: expect.any(String),
        MetricName: expect.any(String),
      }),
    );
  });

  test("GetMetricData asks for one statistic per metric over the window, on the series' exact dimensions", async () => {
    const fake: FakeAws = createFakeAws({
      regions: { "us-east-1": { metrics: ec2("i-0aaa", [10]) } },
    });

    await connector.read(
      keySettings({ regions: "us-east-1" }),
      readOptions(fake),
    );

    const call: { body: JSONObject } = fake.cloudWatchCalls.find(
      (entry: { action: string }): boolean => {
        return entry.action === "GetMetricData";
      },
    )!;
    const queries: Array<JSONObject> = call.body[
      "MetricDataQueries"
    ] as Array<JSONObject>;

    expect(call.body["StartTime"]).toBe(WINDOW_START_S);
    expect(call.body["EndTime"]).toBe(WINDOW_END_S);
    expect(
      queries.map((query: JSONObject) => {
        const stat: JSONObject = query["MetricStat"] as JSONObject;
        const metric: JSONObject = stat["Metric"] as JSONObject;
        return [
          metric["MetricName"],
          stat["Stat"],
          stat["Period"],
          metric["Dimensions"],
        ];
      }),
    ).toEqual([
      [
        "CPUUtilization",
        "Average",
        300,
        [{ Name: "InstanceId", Value: "i-0aaa" }],
      ],
      ["NetworkIn", "Sum", 300, [{ Name: "InstanceId", Value: "i-0aaa" }]],
    ]);
    for (const query of queries) {
      expect(query["Id"]).toMatch(/^q\d+$/);
    }
  });

  test("a read within the hour skips the sweep, and starts where the last one stopped", async () => {
    const fake: FakeAws = createFakeAws({
      regions: { "us-east-1": { metrics: ec2("i-0aaa", [10, 20]) } },
    });

    const first: CloudReadResult = await connector.read(
      keySettings(),
      readOptions(fake),
    );

    fake.cloudWatchCalls.length = 0;

    const tenMinutesLater: Date = new Date(NOW.getTime() + 10 * 60 * 1000);
    const second: CloudReadResult = await connector.read(keySettings(), {
      ...readOptions(fake, first.nextState),
      now: () => {
        return tenMinutesLater;
      },
    });

    // No first-page probes of every Region: only the Region in use is listed.
    expect(
      new Set(
        fake.cloudWatchCalls.map((call: { region: string }): string => {
          return call.region;
        }),
      ),
    ).toEqual(new Set(["us-east-1"]));

    const call: { body: JSONObject } = fake.cloudWatchCalls.find(
      (entry: { action: string }): boolean => {
        return entry.action === "GetMetricData";
      },
    )!;

    expect(call.body["StartTime"]).toBe(WINDOW_END_S);
    expect(call.body["EndTime"]).toBe(WINDOW_END_S + 600);
    expect(second.nextState.fullSweepAt).toBe(first.nextState.fullSweepAt);
  });

  test("nothing new to read yet writes nothing and keeps the cursor", async () => {
    const fake: FakeAws = createFakeAws({
      regions: { "us-east-1": { metrics: ec2("i-0aaa", [10]) } },
    });
    const state: CloudConnectionPullState = {
      cursors: { "300": new Date(WINDOW_END_S * 1000).toISOString() },
      activePairs: ["us-east-1|AWS/EC2"],
      fullSweepAt: NOW.toISOString(),
      inventoryAt: NOW.toISOString(),
      accounts: [FAKE_ACCOUNT_ID],
    };

    const result: CloudReadResult = await connector.read(
      keySettings(),
      readOptions(fake, state),
    );

    expect(result.pointsWritten).toBe(0);
    expect(result.payloads).toEqual([]);
    expect(
      fake.cloudWatchCalls.filter((call: { action: string }): boolean => {
        return call.action === "GetMetricData";
      }),
    ).toHaveLength(0);
    expect(result.nextState.cursors).toEqual(state.cursors);
    // The resources are still seen.
    expect(result.resources).toHaveLength(1);
  });

  test("an EC2 instance is named by its Name tag", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {
        "us-east-1": {
          metrics: ec2("i-0aaa", [10]),
          names: {
            [`arn:aws:ec2:us-east-1:${FAKE_ACCOUNT_ID}:instance/i-0aaa`]:
              "web-prod-1",
          },
        },
      },
    });

    const result: CloudReadResult = await connector.read(
      keySettings({ regions: "us-east-1" }),
      readOptions(fake),
    );

    expect(result.resources[0]!.displayName).toBe("web-prod-1");
    expect(fake.taggingCalls[0]!.body).toEqual(
      expect.objectContaining({
        TagFilters: [{ Key: "Name" }],
        ResourcesPerPage: 100,
      }),
    );
  });

  test("tags the access may not read leave the ids as names, with a warning", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {
        "us-east-1": {
          metrics: ec2("i-0aaa", [10]),
          tagsError: awsError(400, "AccessDeniedException"),
        },
      },
    });

    const result: CloudReadResult = await connector.read(
      keySettings({ regions: "us-east-1" }),
      readOptions(fake),
    );

    expect(result.complete).toBe(true);
    expect(result.resources[0]!.displayName).toBeUndefined();
    expect(result.warnings.join(" ")).toContain("tag:GetResources");
    expect(result.pointsWritten).toBe(2);
  });

  test("throttling is waited out and retried", async () => {
    // The jitter at its most: each wait is its whole backoff (AwsRetry).
    jest.spyOn(AwsRetry, "random").mockReturnValue(1);
    const fake: FakeAws = createFakeAws({
      regions: {
        "us-east-1": {
          metrics: ec2("i-0aaa", [10]),
          getMetricDataAnswers: [
            awsError(400, "Throttling", "Rate exceeded"),
            awsError(400, "Throttling", "Rate exceeded"),
          ],
        },
      },
    });
    const waits: Array<number> = [];

    const result: CloudReadResult = await connector.read(
      keySettings({ regions: "us-east-1" }),
      {
        ...readOptions(fake),
        sleep: async (milliseconds: number) => {
          waits.push(milliseconds);
        },
      },
    );

    expect(waits).toEqual([1000, 2000]);
    expect(result.pointsWritten).toBe(2);
  });

  test("a 503 from CloudWatch for a moment is asked again, as the AWS SDKs ask, and the read goes on", async () => {
    jest.spyOn(AwsRetry, "random").mockReturnValue(1);
    const fake: FakeAws = createFakeAws({
      regions: {
        "us-east-1": {
          metrics: ec2("i-0aaa", [10]),
          getMetricDataAnswers: [
            awsError(503, "ServiceUnavailable", "Please try again"),
          ],
        },
      },
    });
    const waits: Array<number> = [];

    const result: CloudReadResult = await connector.read(
      keySettings({ regions: "us-east-1" }),
      {
        ...readOptions(fake),
        sleep: async (milliseconds: number) => {
          waits.push(milliseconds);
        },
      },
    );

    // A failure for now waits 50 ms at most before its first retry.
    expect(waits).toEqual([50]);
    expect(result.warnings).toEqual([]);
    expect(result.pointsWritten).toBe(2);
    expect(result.nextState.cursors?.["300"]).toBeDefined();
  });

  test("a Region whose metrics fail keeps the whole window for the next read, so nothing is written twice", async () => {
    // Every try fails: the failure is not one a retry gets past.
    const failure: { status: number; body: string } = {
      status: 500,
      body: "Internal failure",
    };
    const fake: FakeAws = createFakeAws({
      regions: {
        "us-east-1": { metrics: ec2("i-0aaa", [10]) },
        "eu-west-1": {
          metrics: ec2("i-0bbb", [20]),
          getMetricDataAnswers: [failure, failure, failure],
        },
      },
    });

    const result: CloudReadResult = await connector.read(
      keySettings({ regions: "us-east-1, eu-west-1" }),
      readOptions(fake),
    );

    expect(result.pointsWritten).toBe(0);
    expect(result.payloads).toEqual([]);
    expect(result.nextState.cursors?.["300"]).toBeUndefined();
    expect(result.warnings.join(" ")).toContain("Could not read metrics");
  });

  test("a read that runs out of budget stops, says so and reads the rest next time", async () => {
    const fake: FakeAws = createFakeAws({
      regions: { "us-east-1": { metrics: ec2("i-0aaa", [10]) } },
    });

    const result: CloudReadResult = await connector.read(
      keySettings({ regions: "us-east-1" }),
      readOptions(fake, {}, { maxRequests: 3 }),
    );

    expect(result.complete).toBe(false);
    expect(result.warnings.join(" ")).toContain("stopped at its limit");
    expect(result.nextState.cursors?.["300"]).toBeUndefined();
    expect(fake.requests.length).toBeLessThanOrEqual(3);
  });

  test("named Regions are the only ones swept, and one that cannot be read is said", async () => {
    const fake: FakeAws = createFakeAws({
      regions: { "us-east-1": { metrics: ec2("i-0aaa", [10]) } },
    });

    const result: CloudReadResult = await connector.read(
      keySettings({ regions: "us-east-1, ap-east-1" }),
      readOptions(fake),
    );

    expect(
      new Set(
        fake.cloudWatchCalls.map((call: { region: string }): string => {
          return call.region;
        }),
      ),
    ).toEqual(new Set(["us-east-1"]));
    expect(result.warnings.join(" ")).toContain("Could not read ap-east-1");
    // A named list is no daily sweep of every Region.
    expect(result.nextState.fullSweepAt).toBeUndefined();
  });

  test("a permission refused while sweeping fails the read", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {
        "us-east-1": {
          metrics: [],
          error: awsError(400, "AccessDenied", "not authorized"),
        },
      },
    });

    await expect(
      connector.read(keySettings({ regions: "us-east-1" }), readOptions(fake)),
    ).rejects.toMatchObject({ kind: CloudConnectionFailureKind.Permission });
  });

  test("a wrong key fails the read before any CloudWatch call", async () => {
    const fake: FakeAws = createFakeAws({
      regions: { "us-east-1": { metrics: [] } },
      callerIdentityError: stsError(403, "SignatureDoesNotMatch"),
    });

    const error: unknown = await connector
      .read(keySettings(), readOptions(fake))
      .catch((caught: unknown) => {
        return caught;
      });

    expect(error).toBeInstanceOf(LlmProviderError);
    expect((error as LlmProviderError).kind).toBe(
      CloudConnectionFailureKind.Authentication,
    );
    expect(fake.cloudWatchCalls).toHaveLength(0);
  });

  test("a role is assumed once and its session reused by the next read", async () => {
    giveOneUptimeAnAwsIdentity();
    const fake: FakeAws = createFakeAws({
      regions: { "us-east-1": { metrics: ec2("i-0aaa", [10]) } },
    });
    const settings: CloudConnectionSettings = {
      ...roleSettings(),
      config: { ...roleSettings().config, regions: "us-east-1" },
    };

    const first: CloudReadResult = await connector.read(
      settings,
      readOptions(fake),
    );
    await connector.read(settings, {
      ...readOptions(fake, first.nextState),
      now: () => {
        return new Date(NOW.getTime() + 10 * 60 * 1000);
      },
    });

    expect(
      fake.stsCalls.filter((call: { action: string }): boolean => {
        return call.action === "AssumeRole";
      }),
    ).toHaveLength(1);
  });

  /*
   * An Amazon MQ broker's CPU is CpuUtilization on ActiveMQ and
   * SystemCpuUtilization on RabbitMQ: a Region with RabbitMQ brokers alone
   * was never found by a sweep that asked for ActiveMQ's.
   */
  test("a Region of RabbitMQ brokers alone is found, and their metrics read", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {
        "us-east-1": {
          metrics: [
            {
              namespace: "AWS/AmazonMQ",
              metricName: "SystemCpuUtilization",
              dimensions: [["Broker", "orders-broker"]],
              values: [[WINDOW_START_S, 12]],
            },
            {
              namespace: "AWS/AmazonMQ",
              metricName: "MessageCount",
              dimensions: [["Broker", "orders-broker"]],
              values: [[WINDOW_START_S, 340]],
            },
          ],
        },
      },
    });

    const result: CloudReadResult = await connector.read(
      keySettings({ regions: "us-east-1" }),
      readOptions(fake),
    );

    expect(result.nextState.activePairs).toContain("us-east-1|AWS/AmazonMQ");
    expect(
      resolvedFromPayloads(result)
        .map((entry: { metricName: string }): string => {
          return entry.metricName;
        })
        .sort(),
    ).toEqual([
      "amazonaws.com/AWS/AmazonMQ/MessageCount",
      "amazonaws.com/AWS/AmazonMQ/SystemCpuUtilization",
    ]);
  });

  test("a Region of no broker asks for both brokers' CPU, and reads nothing", async () => {
    const fake: FakeAws = createFakeAws({
      regions: { "us-east-1": { metrics: [] } },
    });

    const result: CloudReadResult = await connector.read(
      keySettings({ regions: "us-east-1" }),
      readOptions(fake),
    );
    const asked: Array<unknown> = fake.cloudWatchCalls
      .filter((call: { action: string; body: JSONObject }): boolean => {
        return (
          call.action === "ListMetrics" &&
          call.body["Namespace"] === "AWS/AmazonMQ"
        );
      })
      .map((call: { body: JSONObject }): unknown => {
        return call.body["MetricName"];
      });

    expect(asked).toEqual(["CpuUtilization", "SystemCpuUtilization"]);
    expect(result.nextState.activePairs || []).not.toContain(
      "us-east-1|AWS/AmazonMQ",
    );
  });

  test("the key metrics added since streams began are read too, each with its own statistic", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {
        "us-east-1": {
          metrics: [
            ...ec2("i-0aaa", [10]),
            {
              namespace: "AWS/EC2",
              metricName: "CPUCreditBalance",
              dimensions: [["InstanceId", "i-0aaa"]],
              values: [[WINDOW_START_S, 144]],
            },
            {
              namespace: "AWS/EC2",
              metricName: "EBSReadBytes",
              dimensions: [["InstanceId", "i-0aaa"]],
              values: [[WINDOW_START_S, 4096]],
            },
          ],
        },
      },
    });

    await connector.read(
      keySettings({ regions: "us-east-1" }),
      readOptions(fake),
    );

    const queries: Array<JSONObject> = fake.cloudWatchCalls
      .filter((call: { action: string }): boolean => {
        return call.action === "GetMetricData";
      })
      .flatMap((call: { body: JSONObject }): Array<JSONObject> => {
        return call.body["MetricDataQueries"] as Array<JSONObject>;
      });
    const statOf: (metricName: string) => unknown = (
      metricName: string,
    ): unknown => {
      return (
        queries.find((query: JSONObject): boolean => {
          return (
            ((query["MetricStat"] as JSONObject)["Metric"] as JSONObject)[
              "MetricName"
            ] === metricName
          );
        })?.["MetricStat"] as JSONObject | undefined
      )?.["Stat"];
    };

    expect(statOf("CPUCreditBalance")).toBe("Average");
    expect(statOf("EBSReadBytes")).toBe("Sum");
    expect(statOf("CPUUtilization")).toBe("Average");
  });

  /*
   * #9564: an account that streams pays CloudWatch only for what its
   * stream does not carry. A key metric its stack carries, of a namespace
   * it delivered lately, is not read - but where the resource's health or
   * headline is judged from it, so its health reads the same.
   */
  describe("of an account that streams", () => {
    function metricsQueried(fake: FakeAws): Array<string> {
      return fake.cloudWatchCalls
        .filter((call: { action: string }): boolean => {
          return call.action === "GetMetricData";
        })
        .flatMap((call: { body: JSONObject }): Array<JSONObject> => {
          return call.body["MetricDataQueries"] as Array<JSONObject>;
        })
        .map((query: JSONObject): string => {
          const metric: JSONObject = (query["MetricStat"] as JSONObject)[
            "Metric"
          ] as JSONObject;

          return `${metric["Namespace"] as string}/${metric["MetricName"] as string}`;
        })
        .sort();
    }

    function streaming(
      sources: Array<Partial<CloudStreamMetricSource>>,
    ): AwsStreamCoverage {
      return getAwsStreamCoverage({
        summary: {
          metricSources: sources.map(
            (
              source: Partial<CloudStreamMetricSource>,
            ): CloudStreamMetricSource => {
              return {
                accountId: FAKE_ACCOUNT_ID,
                region: "us-east-1",
                namespaces: ["AWS/EC2"],
                lastAt: new Date(NOW.getTime() - 60 * 1000).toISOString(),
                ...source,
              };
            },
          ),
          logSources: [],
        },
        now: NOW,
      });
    }

    function instanceWithNewerMetrics(): Array<FakeMetric> {
      return [
        ...ec2("i-0aaa", [10]),
        {
          namespace: "AWS/EC2",
          metricName: "CPUCreditBalance",
          dimensions: [["InstanceId", "i-0aaa"]],
          values: [[WINDOW_START_S, 144]],
        },
        {
          namespace: "AWS/EC2",
          metricName: "EBSReadBytes",
          dimensions: [["InstanceId", "i-0aaa"]],
          values: [[WINDOW_START_S, 4096]],
        },
      ];
    }

    test("of template 2 reads only what the instance's health and headlines are judged from", async () => {
      const fake: FakeAws = createFakeAws({
        regions: { "us-east-1": { metrics: instanceWithNewerMetrics() } },
      });

      const result: CloudReadResult = await connector.read(
        keySettings({ regions: "us-east-1" }),
        {
          ...readOptions(fake),
          awsStreamCoverage: streaming([
            { templateVersion: 2, everyMetric: false },
          ]),
        },
      );

      // CPU and network lead the instance's page; its credits and EBS bytes do not.
      expect(metricsQueried(fake)).toEqual([
        "AWS/EC2/CPUUtilization",
        "AWS/EC2/NetworkIn",
      ]);
      // It is still found, from its listed series.
      expect(
        result.resources.map((found: CloudDiscoveredResource) => {
          return found.resource.resourceType;
        }),
      ).toEqual(["AWS::EC2::Instance"]);
    });

    test("of a stack that says no template reads what it does not carry, as if the account did not stream", async () => {
      const fake: FakeAws = createFakeAws({
        regions: { "us-east-1": { metrics: instanceWithNewerMetrics() } },
      });

      await connector.read(keySettings({ regions: "us-east-1" }), {
        ...readOptions(fake),
        awsStreamCoverage: streaming([{}]),
      });

      expect(metricsQueried(fake)).toEqual([
        "AWS/EC2/CPUCreditBalance",
        "AWS/EC2/CPUUtilization",
        "AWS/EC2/EBSReadBytes",
        "AWS/EC2/NetworkIn",
      ]);
    });

    test("reads every key metric of a Region or namespace no stream delivered lately", async () => {
      for (const coverage of [
        streaming([{ region: "eu-west-1", templateVersion: 2 }]),
        streaming([{ namespaces: ["AWS/RDS"], templateVersion: 2 }]),
        streaming([
          {
            templateVersion: 2,
            lastAt: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
          },
        ]),
      ]) {
        const fake: FakeAws = createFakeAws({
          regions: { "us-east-1": { metrics: instanceWithNewerMetrics() } },
        });

        await connector.read(keySettings({ regions: "us-east-1" }), {
          ...readOptions(fake),
          awsStreamCoverage: coverage,
        });

        expect(metricsQueried(fake)).toHaveLength(4);
      }
    });

    /*
     * A Neptune cluster's metrics feed no reading: a stream of template 2
     * writes them all, so nothing of the period is read - and its window
     * is done all the same, so a stream that goes quiet is read from here,
     * never again from the hours it wrote.
     */
    test("reads nothing of a period a stream writes whole, and moves its cursor on", async () => {
      const fake: FakeAws = createFakeAws({
        regions: {
          "us-east-1": {
            metrics: [
              {
                namespace: "AWS/Neptune",
                metricName: "CPUUtilization",
                dimensions: [["DBClusterIdentifier", "graph"]],
                values: [[WINDOW_START_S, 12]],
              },
            ],
          },
        },
      });

      const result: CloudReadResult = await connector.read(
        keySettings({ regions: "us-east-1" }),
        {
          ...readOptions(fake),
          awsStreamCoverage: streaming([
            { namespaces: ["AWS/Neptune"], templateVersion: 2 },
          ]),
        },
      );

      expect(metricsQueried(fake)).toEqual([]);
      expect(result.payloads).toEqual([]);
      expect(result.resources).toHaveLength(1);
      expect(result.nextState.cursors?.["300"]).toBe(
        new Date(WINDOW_END_S * 1000).toISOString(),
      );
    });
  });

  /*
   * A Network Firewall publishes ReceivedPackets for each engine that saw a
   * packet; only its Stateless (Classic policy) or System (Next Generation
   * policy) series counts every one. The read reads those alone, and every
   * engine's drops.
   */
  test("a firewall's received packets are read from the engine that counts every packet alone", async () => {
    const firewallSeries: (metricName: string, engine: string) => FakeMetric = (
      metricName: string,
      engine: string,
    ): FakeMetric => {
      return {
        namespace: "AWS/NetworkFirewall",
        metricName,
        dimensions: [
          ["AvailabilityZone", "us-east-1a"],
          ["Engine", engine],
          ["FirewallName", "edge"],
        ],
        values: [[WINDOW_START_S, 100]],
      };
    };
    const fake: FakeAws = createFakeAws({
      regions: {
        "us-east-1": {
          metrics: [
            firewallSeries("ReceivedPackets", "System"),
            firewallSeries("ReceivedPackets", "Firewall"),
            firewallSeries("DroppedPackets", "Firewall"),
            firewallSeries("DroppedPackets", "IPS"),
          ],
        },
      },
    });

    await connector.read(
      keySettings({ regions: "us-east-1" }),
      readOptions(fake),
    );

    const engines: Array<string> = fake.cloudWatchCalls
      .filter((call: { action: string }): boolean => {
        return call.action === "GetMetricData";
      })
      .flatMap((call: { body: JSONObject }): Array<JSONObject> => {
        return call.body["MetricDataQueries"] as Array<JSONObject>;
      })
      .map((query: JSONObject): string => {
        const metric: JSONObject = (query["MetricStat"] as JSONObject)[
          "Metric"
        ] as JSONObject;
        const engine: JSONObject | undefined = (
          metric["Dimensions"] as Array<JSONObject>
        ).find((dimension: JSONObject): boolean => {
          return dimension["Name"] === "Engine";
        });

        return `${metric["MetricName"] as string} ${engine?.["Value"] as string}`;
      })
      .sort();

    expect(engines).toEqual([
      "DroppedPackets Firewall",
      "DroppedPackets IPS",
      "ReceivedPackets System",
    ]);
  });

  test("S3's daily storage figures are read once a whole day has been published", async () => {
    // 12:07 on the 21st: the last whole day read is the 19th (a day and a half back).
    const day19: number = Date.UTC(2026, 9, 19) / 1000;
    const fake: FakeAws = createFakeAws({
      regions: {
        "us-east-1": {
          metrics: [
            {
              namespace: "AWS/S3",
              metricName: "BucketSizeBytes",
              dimensions: [
                ["BucketName", "assets"],
                ["StorageType", "StandardStorage"],
              ],
              values: [[day19, 5e9]],
            },
          ],
        },
      },
    });

    const result: CloudReadResult = await connector.read(
      keySettings({ regions: "us-east-1" }),
      readOptions(fake),
    );

    const call: { body: JSONObject } = fake.cloudWatchCalls.find(
      (entry: { action: string }): boolean => {
        return entry.action === "GetMetricData";
      },
    )!;
    const query: JSONObject = (
      call.body["MetricDataQueries"] as Array<JSONObject>
    )[0]!;

    expect((query["MetricStat"] as JSONObject)["Period"]).toBe(86400);
    expect(call.body["StartTime"]).toBe(day19);
    expect(call.body["EndTime"]).toBe(day19 + 86400);
    expect(result.pointsWritten).toBe(1);
    expect(result.nextState.cursors).toEqual({
      "86400": new Date((day19 + 86400) * 1000).toISOString(),
    });
  });

  /*
   * ACM publishes a certificate's DaysToExpiry twice a day: read once an
   * hour, over the hour that ended an hour before, and listed whatever its
   * last point's age - the last three hours' listing would hold it for a
   * few hours after each point and lose it for the rest of the day.
   */
  describe("a certificate's days to expiry", () => {
    const CERTIFICATE_ARN: string =
      "arn:aws:acm:us-east-1:123456789012:certificate/0f4a8f3e-6c2b-4e7a-9d1c-2b3a4c5d6e7f";
    // 12:07: the hourly window ends an hour back, on the hour: 11:00.
    const HOURLY_END_S: number = Date.UTC(2026, 9, 21, 11) / 1000;
    const HOURLY_START_S: number = HOURLY_END_S - 3 * 3600;

    function certificate(values: Array<[number, number]>): FakeMetric {
      return {
        namespace: "AWS/CertificateManager",
        metricName: "DaysToExpiry",
        dimensions: [["CertificateArn", CERTIFICATE_ARN]],
        values: values,
        // Its last point is hours old: RecentlyActive would not list it.
        quiet: true,
      };
    }

    function listCallsOf(
      fake: FakeAws,
      namespace: string,
    ): Array<{ body: JSONObject }> {
      return fake.cloudWatchCalls.filter(
        (call: { action: string; body: JSONObject }): boolean => {
          return (
            call.action === "ListMetrics" &&
            call.body["Namespace"] === namespace
          );
        },
      );
    }

    test("are listed whatever their last point's age, while every other namespace keeps the last three hours", async () => {
      const fake: FakeAws = createFakeAws({
        regions: {
          "us-east-1": {
            metrics: [
              ...ec2("i-0aaa", [10]),
              // Published at 09:00, twice a day.
              certificate([[HOURLY_END_S - 2 * 3600, 41]]),
              // An instance that stopped reporting hours ago: not listed.
              {
                namespace: "AWS/EC2",
                metricName: "CPUUtilization",
                dimensions: [["InstanceId", "i-0quiet"]],
                quiet: true,
              },
            ],
          },
        },
      });

      const result: CloudReadResult = await connector.read(
        keySettings({ regions: "us-east-1" }),
        readOptions(fake),
      );

      expect(result.nextState.activePairs).toContain(
        "us-east-1|AWS/CertificateManager",
      );
      expect(
        result.resources
          .map((entry: CloudDiscoveredResource): string => {
            return `${entry.resource.resourceType} ${entry.resource.name}`;
          })
          .sort(),
      ).toEqual([
        "AWS::CertificateManager::Certificate 0f4a8f3e-6c2b-4e7a-9d1c-2b3a4c5d6e7f",
        "AWS::EC2::Instance i-0aaa",
      ]);

      // ACM's listings never ask for RecentlyActive; EC2's always do.
      const acmLists: Array<{ body: JSONObject }> = listCallsOf(
        fake,
        "AWS/CertificateManager",
      );

      expect(acmLists.length).toBeGreaterThan(0);
      for (const call of acmLists) {
        expect(call.body["RecentlyActive"]).toBeUndefined();
        expect(call.body["MetricName"]).toBe("DaysToExpiry");
      }

      for (const call of listCallsOf(fake, "AWS/EC2")) {
        expect(call.body["RecentlyActive"]).toBe("PT3H");
      }
    });

    test("are read an hour at a time, over the hours that ended an hour before, with their own cursor", async () => {
      const fake: FakeAws = createFakeAws({
        regions: {
          "us-east-1": {
            metrics: [
              ...ec2("i-0aaa", [10]),
              certificate([
                // Yesterday evening's: before the first read's three hours.
                [HOURLY_END_S - 14 * 3600, 42],
                // This morning's, at 09:00.
                [HOURLY_END_S - 2 * 3600, 41],
              ]),
            ],
          },
        },
      });

      const first: CloudReadResult = await connector.read(
        keySettings({ regions: "us-east-1" }),
        readOptions(fake),
      );

      const hourly: Array<{ body: JSONObject }> = fake.cloudWatchCalls.filter(
        (call: { action: string; body: JSONObject }): boolean => {
          return (
            call.action === "GetMetricData" &&
            (
              (call.body["MetricDataQueries"] as Array<JSONObject>)[0]![
                "MetricStat"
              ] as JSONObject
            )["Period"] === 3600
          );
        },
      );

      expect(hourly).toHaveLength(1);
      expect(hourly[0]!.body["StartTime"]).toBe(HOURLY_START_S);
      expect(hourly[0]!.body["EndTime"]).toBe(HOURLY_END_S);

      const stat: JSONObject = (
        hourly[0]!.body["MetricDataQueries"] as Array<JSONObject>
      )[0]!["MetricStat"] as JSONObject;

      expect(stat["Stat"]).toBe("Minimum");
      expect((stat["Metric"] as JSONObject)["MetricName"]).toBe("DaysToExpiry");
      expect((stat["Metric"] as JSONObject)["Dimensions"]).toEqual([
        { Name: "CertificateArn", Value: CERTIFICATE_ARN },
      ]);

      // The five-minute metrics and the hourly one keep cursors of their own.
      expect(first.nextState.cursors).toEqual({
        "300": new Date(WINDOW_END_S * 1000).toISOString(),
        "3600": new Date(HOURLY_END_S * 1000).toISOString(),
      });

      // This morning's reading is written, on the certificate.
      const written: Array<{
        metricName: string;
        resource: CloudMonitoredResource;
      }> = resolvedFromPayloads(first).filter(
        (entry: { metricName: string }): boolean => {
          return (
            entry.metricName ===
            "amazonaws.com/AWS/CertificateManager/DaysToExpiry"
          );
        },
      );

      expect(written).toHaveLength(1);
      expect(written[0]!.resource.resourceType).toBe(
        "AWS::CertificateManager::Certificate",
      );
      expect(written[0]!.resource.providerResourceId).toBe(CERTIFICATE_ARN);

      // Ten minutes on, no new whole hour: no hourly read.
      fake.cloudWatchCalls.length = 0;

      await connector.read(keySettings({ regions: "us-east-1" }), {
        ...readOptions(fake, first.nextState),
        now: () => {
          return new Date(NOW.getTime() + 10 * 60 * 1000);
        },
      });

      expect(
        fake.cloudWatchCalls.filter(
          (call: { action: string; body: JSONObject }): boolean => {
            return (
              call.action === "GetMetricData" &&
              (
                (call.body["MetricDataQueries"] as Array<JSONObject>)[0]![
                  "MetricStat"
                ] as JSONObject
              )["Period"] === 3600
            );
          },
        ),
      ).toHaveLength(0);

      // An hour on, the next hour.
      fake.cloudWatchCalls.length = 0;

      const later: CloudReadResult = await connector.read(
        keySettings({ regions: "us-east-1" }),
        {
          ...readOptions(fake, first.nextState),
          now: () => {
            return new Date(NOW.getTime() + 60 * 60 * 1000);
          },
        },
      );

      const next: { body: JSONObject } | undefined = fake.cloudWatchCalls.find(
        (call: { action: string; body: JSONObject }): boolean => {
          return (
            call.action === "GetMetricData" &&
            (
              (call.body["MetricDataQueries"] as Array<JSONObject>)[0]![
                "MetricStat"
              ] as JSONObject
            )["Period"] === 3600
          );
        },
      );

      expect(next?.body["StartTime"]).toBe(HOURLY_END_S);
      expect(next?.body["EndTime"]).toBe(HOURLY_END_S + 3600);
      expect(later.nextState.cursors!["3600"]).toBe(
        new Date((HOURLY_END_S + 3600) * 1000).toISOString(),
      );
    });
  });
});

/*
 * ---- Metrics a person added to the reads (#9563) -------------------------
 *
 * GetMetricData bills each metric read, so an addition is read only of the
 * resources it is for, in the GetMetricData calls the key metrics are read
 * in: a type's listed in its namespace like a key metric and kept for the
 * resources of its type, a resource's own on the series its listing found,
 * with no listing call each read. A stream of every metric writes it
 * already, so the read leaves it to the stream.
 */
describe("metrics a person added to the reads", () => {
  const INSTANCE: string = "AWS::EC2::Instance";

  function added(overrides: Partial<CloudAddedMetric> = {}): CloudAddedMetric {
    const metric: CloudAddedMetric = {
      key: "",
      provider: CloudProvider.AWS,
      scope: CloudAddedMetricScope.Type,
      resourceType: INSTANCE,
      namespace: "AWS/EC2",
      name: "MetadataNoToken",
      aggregation: "Sum",
      unit: "",
      addedAt: NOW.toISOString(),
      ...overrides,
    };

    return { ...metric, key: getCloudAddedMetricKey(metric) };
  }

  function ownAddition(
    overrides: Partial<CloudAddedMetric> = {},
  ): CloudAddedMetric {
    return added({
      scope: CloudAddedMetricScope.Resource,
      cloudResourceId: "c1d2e3f4-0000-4000-8000-000000000001",
      accountId: FAKE_ACCOUNT_ID,
      region: "us-east-1",
      dimensions: [{ name: "InstanceId", value: "i-0aaa" }],
      ...overrides,
    });
  }

  // Two instances, and an Auto Scaling group's own series of the metric.
  function instances(): FakeAws {
    return createFakeAws({
      regions: {
        "us-east-1": {
          metrics: [
            ...ec2("i-0aaa", [10]),
            ...ec2("i-0bbb", [20]),
            {
              namespace: "AWS/EC2",
              metricName: "MetadataNoToken",
              dimensions: [["InstanceId", "i-0aaa"]],
              values: [[WINDOW_START_S, 3]],
            },
            {
              namespace: "AWS/EC2",
              metricName: "MetadataNoToken",
              dimensions: [["InstanceId", "i-0bbb"]],
              values: [[WINDOW_START_S, 4]],
            },
            {
              namespace: "AWS/EC2",
              metricName: "MetadataNoToken",
              dimensions: [["AutoScalingGroupName", "web-asg"]],
              values: [[WINDOW_START_S, 7]],
            },
          ],
        },
      },
    });
  }

  function queriesOf(fake: FakeAws): Array<{
    metricName: string;
    dimensions: string;
    stat: string;
  }> {
    return fake.cloudWatchCalls
      .filter((call: { action: string }): boolean => {
        return call.action === "GetMetricData";
      })
      .flatMap((call: { body: JSONObject }) => {
        return (call.body["MetricDataQueries"] as Array<JSONObject>).map(
          (query: JSONObject) => {
            const stat: JSONObject = query["MetricStat"] as JSONObject;
            const metric: JSONObject = stat["Metric"] as JSONObject;

            return {
              metricName: String(metric["MetricName"]),
              dimensions: ((metric["Dimensions"] || []) as Array<JSONObject>)
                .map((dimension: JSONObject): string => {
                  return `${dimension["Name"]}=${dimension["Value"]}`;
                })
                .join(","),
              stat: String(stat["Stat"]),
            };
          },
        );
      });
  }

  function listedNames(fake: FakeAws): Array<string> {
    return fake.cloudWatchCalls
      .filter((call: { action: string }): boolean => {
        return call.action === "ListMetrics";
      })
      .map((call: { body: JSONObject }): string => {
        return String(call.body["MetricName"] || "");
      });
  }

  test("a type's addition is listed in its namespace and read for each resource of its type, in the same GetMetricData call", async () => {
    const fake: FakeAws = instances();

    const result: CloudReadResult = await connector.read(
      keySettings({ regions: "us-east-1" }),
      { ...readOptions(fake), addedMetrics: [added()] },
    );

    expect(listedNames(fake)).toContain("MetadataNoToken");
    expect(
      queriesOf(fake).filter((query: { metricName: string }): boolean => {
        return query.metricName === "MetadataNoToken";
      }),
    ).toEqual([
      {
        metricName: "MetadataNoToken",
        dimensions: "InstanceId=i-0aaa",
        stat: "Sum",
      },
      {
        metricName: "MetadataNoToken",
        dimensions: "InstanceId=i-0bbb",
        stat: "Sum",
      },
    ]);
    // One call for every series of the period, key metrics and added.
    expect(
      fake.cloudWatchCalls.filter((call: { action: string }): boolean => {
        return call.action === "GetMetricData";
      }),
    ).toHaveLength(1);

    const written: Array<{ metricName: string; attributes: JSONObject }> =
      resolvedFromPayloads(result).filter(
        (entry: { metricName: string }): boolean => {
          return entry.metricName === "amazonaws.com/AWS/EC2/MetadataNoToken";
        },
      );

    expect(
      written.map((entry: { attributes: JSONObject }) => {
        return entry.attributes["Dimensions.InstanceId"];
      }),
    ).toEqual(["i-0aaa", "i-0bbb"]);
  });

  test("a resource's own addition is read on the series its listing found, with no listing call", async () => {
    const fake: FakeAws = instances();

    const result: CloudReadResult = await connector.read(
      keySettings({ regions: "us-east-1" }),
      { ...readOptions(fake), addedMetrics: [ownAddition()] },
    );

    expect(listedNames(fake)).not.toContain("MetadataNoToken");
    expect(
      queriesOf(fake).filter((query: { metricName: string }): boolean => {
        return query.metricName === "MetadataNoToken";
      }),
    ).toEqual([
      {
        metricName: "MetadataNoToken",
        dimensions: "InstanceId=i-0aaa",
        stat: "Sum",
      },
    ]);
    expect(
      resolvedFromPayloads(result)
        .filter((entry: { metricName: string }): boolean => {
          return entry.metricName === "amazonaws.com/AWS/EC2/MetadataNoToken";
        })
        .map((entry: { attributes: JSONObject }) => {
          return entry.attributes["Dimensions.InstanceId"];
        }),
    ).toEqual(["i-0aaa"]);
  });

  test("a resource's own addition of another account, or of a Region or namespace the account has no resources in, is not read", async () => {
    const fake: FakeAws = instances();

    await connector.read(keySettings({ regions: "us-east-1" }), {
      ...readOptions(fake),
      addedMetrics: [
        ownAddition({ accountId: "999999999999" }),
        ownAddition({ region: "eu-west-1", cloudResourceId: "other-row-1" }),
        ownAddition({ namespace: "AWS/RDS", cloudResourceId: "other-row-2" }),
      ],
    });

    expect(
      queriesOf(fake).filter((query: { metricName: string }): boolean => {
        return query.metricName === "MetadataNoToken";
      }),
    ).toEqual([]);
  });

  test("an addition a stream of every metric writes already is left to it; a key-metric stream does not carry it", async () => {
    const coverage: (everyMetric: boolean) => AwsStreamCoverage = (
      everyMetric: boolean,
    ): AwsStreamCoverage => {
      return getAwsStreamCoverage({
        summary: {
          metricSources: [
            {
              accountId: FAKE_ACCOUNT_ID,
              region: "us-east-1",
              namespaces: ["AWS/EC2"],
              lastAt: new Date(NOW.getTime() - 60 * 1000).toISOString(),
              templateVersion: 2,
              everyMetric,
            },
          ],
          logSources: [],
        },
        now: NOW,
      });
    };

    const whole: FakeAws = instances();
    const wholeResult: CloudReadResult = await connector.read(
      keySettings({ regions: "us-east-1" }),
      {
        ...readOptions(whole),
        awsStreamCoverage: coverage(true),
        addedMetrics: [added(), ownAddition({ name: "DiskReadOps" })],
      },
    );

    expect(
      queriesOf(whole).filter((query: { metricName: string }): boolean => {
        return (
          query.metricName === "MetadataNoToken" ||
          query.metricName === "DiskReadOps"
        );
      }),
    ).toEqual([]);
    expect(
      resolvedFromPayloads(wholeResult).some(
        (entry: { metricName: string }): boolean => {
          return entry.metricName === "amazonaws.com/AWS/EC2/MetadataNoToken";
        },
      ),
    ).toBe(false);

    const keyOnly: FakeAws = instances();
    await connector.read(keySettings({ regions: "us-east-1" }), {
      ...readOptions(keyOnly),
      awsStreamCoverage: coverage(false),
      addedMetrics: [added()],
    });

    expect(
      queriesOf(keyOnly).filter((query: { metricName: string }): boolean => {
        return query.metricName === "MetadataNoToken";
      }),
    ).toHaveLength(2);
  });

  test("an addition that is a key metric of its namespace is read once, as the key metric", async () => {
    // EC2's listing calls of CPUUtilization and NetworkIn in a read.
    const ec2Listings: (fake: FakeAws) => Array<string> = (
      fake: FakeAws,
    ): Array<string> => {
      return fake.cloudWatchCalls
        .filter((call: { action: string; body: JSONObject }): boolean => {
          return (
            call.action === "ListMetrics" &&
            call.body["Namespace"] === "AWS/EC2" &&
            (call.body["MetricName"] === "CPUUtilization" ||
              call.body["MetricName"] === "NetworkIn")
          );
        })
        .map((call: { body: JSONObject }): string => {
          return String(call.body["MetricName"]);
        });
    };

    const without: FakeAws = instances();
    await connector.read(
      keySettings({ regions: "us-east-1" }),
      readOptions(without),
    );

    const fake: FakeAws = instances();
    await connector.read(keySettings({ regions: "us-east-1" }), {
      ...readOptions(fake),
      addedMetrics: [
        added({ name: "CPUUtilization", aggregation: "Maximum" }),
        ownAddition({ name: "NetworkIn" }),
      ],
    });

    expect(
      queriesOf(fake)
        .filter((query: { metricName: string }): boolean => {
          return (
            query.metricName === "CPUUtilization" ||
            query.metricName === "NetworkIn"
          );
        })
        .map((query: { metricName: string; stat: string }): string => {
          return `${query.metricName}:${query.stat}`;
        })
        .sort(),
    ).toEqual([
      "CPUUtilization:Average",
      "CPUUtilization:Average",
      "NetworkIn:Sum",
      "NetworkIn:Sum",
    ]);
    // Listed as often as without the additions.
    expect(ec2Listings(fake)).toEqual(ec2Listings(without));
  });
});
