import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import AwsCloudConnector from "../../../../Server/Utils/CloudConnection/Aws/AwsCloudConnector";
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
import { getAwsExternalIdForProject } from "../../../../Types/CloudConnection/CloudConnectionSetupCommands";
import {
  CloudConnectionFailureKind,
  CloudConnectionTestResult,
} from "../../../../Types/CloudConnection/CloudConnectionTest";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
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
const ROLE_ARN: string = "arn:aws:iam::123456789012:role/OneUptimeReadOnly-5f3a9c1e";
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
    config: { authMethod: CloudConnectionAuthMethod.AwsRole, roleArn: ROLE_ARN },
    secrets: {},
  };
}

function ec2(instanceId: string, values: Array<number> = []): Array<FakeMetric> {
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
});

function giveOneUptimeAnAwsIdentity(): void {
  process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"] = "AKIAONEUPTIMESERVER1";
  process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"] = "oneuptime-server-secret";
}

describe("validateSettings", () => {
  test("an access key and its secret are enough; Regions are optional", () => {
    expect(() => {
      connector.validateSettings(keySettings());
    }).not.toThrow();
    expect(() => {
      connector.validateSettings(keySettings({ regions: "us-east-1, eu-west-1" }));
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
        "us-east-1": { metrics: [...ec2("i-0aaa"), ...ec2("i-0bbb"), ...alb()] },
        "eu-west-1": { metrics: ec2("i-0ccc") },
        "us-west-2": { metrics: [] },
      },
    });

    const result: CloudConnectionTestResult = await connector.testConnection(
      keySettings(),
      { transport: fake.transport, now: () => NOW },
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
      now: () => NOW,
    });

    const listMetrics: DataSourceHttpRequest = fake.requests.find(
      (request: DataSourceHttpRequest): boolean => {
        return new URL(request.url).host === "monitoring.us-east-1.amazonaws.com";
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
      { transport: fake.transport, now: () => NOW },
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
      { transport: fake.transport, now: () => NOW },
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
      { transport: fake.transport, now: () => NOW },
    );

    expect(result.status).toBe("fail");
    expect(result.failureKind).toBe(CloudConnectionFailureKind.Permission);
  });

  test("settings the form can fix are its answer, as a settings failure", async () => {
    const fake: FakeAws = createFakeAws({ regions: {} });

    const result: CloudConnectionTestResult = await connector.testConnection(
      keySettings({ regions: "nowhere" }),
      { transport: fake.transport, now: () => NOW },
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
      { ...roleSettings(), config: { ...roleSettings().config, regions: "us-east-1" } },
      { transport: fake.transport, now: () => NOW },
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

    expect(headers["Authorization"]).toContain("Credential=ASIAASSUMEDROLE00001/");
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
      { transport: fake.transport, now: () => NOW },
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
          return entry.metricName === "amazonaws.com/AWS/ApplicationELB/RequestCount";
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

    await connector.read(keySettings({ regions: "us-east-1" }), readOptions(fake));

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
        return [metric["MetricName"], stat["Stat"], stat["Period"], metric["Dimensions"]];
      }),
    ).toEqual([
      ["CPUUtilization", "Average", 300, [{ Name: "InstanceId", Value: "i-0aaa" }]],
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
      now: () => tenMinutesLater,
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

  test("a Region whose metrics fail keeps the whole window for the next read, so nothing is written twice", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {
        "us-east-1": { metrics: ec2("i-0aaa", [10]) },
        "eu-west-1": {
          metrics: ec2("i-0bbb", [20]),
          getMetricDataAnswers: [{ status: 500, body: "Internal failure" }],
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
      now: () => new Date(NOW.getTime() + 10 * 60 * 1000),
    });

    expect(
      fake.stsCalls.filter((call: { action: string }): boolean => {
        return call.action === "AssumeRole";
      }),
    ).toHaveLength(1);
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
});
