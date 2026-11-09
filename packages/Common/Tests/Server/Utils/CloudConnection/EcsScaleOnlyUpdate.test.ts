import { beforeEach, describe, expect, test } from "@jest/globals";
import {
  isAwsScaleOnlyUpdate,
  readAwsTrailEvent,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsChanges";
import AwsCloudConnector from "../../../../Server/Utils/CloudConnection/Aws/AwsCloudConnector";
import { AssumedRoleCache } from "../../../../Server/Utils/CloudConnection/Aws/AwsSts";
import AwsServerIdentity from "../../../../Server/Utils/CloudConnection/Aws/AwsServerIdentity";
import {
  buildCloudChangeEntry,
  classifyCloudChange,
} from "../../../../Server/Utils/CloudConnection/CloudChangeRecorder";
import {
  CloudChange,
  CloudChangesResult,
  CloudConnectionPullState,
  CloudReadBudget,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { ParsedChangeEventEntry } from "../../../../Server/Utils/Telemetry/ChangeEventRow";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { ChangeEventType } from "../../../../Utils/Telemetry/ChangeEventFields";
import { FAKE_ACCOUNT_ID, FakeAws, createFakeAws } from "./FakeAwsApi";

/*
 * AN ECS UPDATESERVICE THAT ONLY SCALES IS SCALING, NOT A DEPLOY (#6149's
 * follow-up).
 *
 * ECS changes a service's desired count and its task definition with one
 * call, UpdateService, and the recorder classified every one of them as a
 * deploy by its name: Application Auto Scaling's scale-outs, a
 * `--desired-count`, the Cloud AI agent's scale-out all read as deploys on
 * an account's Changes, the chart markers and an investigation's "what
 * changed". A request that names the service and sets only its desired
 * count - Terraform's forceNewDeployment false beside it changes nothing -
 * is scaling now; anything that starts a deployment (a task definition, a
 * forced deployment, a network, capacity or load balancer change) keeps it
 * a deploy. Only the names of the request's parameters are read, and
 * whether a forced deployment was asked for; no value is ever kept.
 */

const ACCOUNT: string = "123456789012";
const SERVICE_ARN: string = `arn:aws:ecs:us-east-1:${ACCOUNT}:service/prod/checkout`;
// A count no id, time or name in these events holds, so a leak would show.
const DESIRED_COUNT: number = 4711;

const AUTOSCALING_SESSION: string = "AutoScaling";

// A CloudTrail event of ECS UpdateService, as LookupEvents lists it.
function updateServiceEvent(data: {
  id: string;
  requestParameters?: unknown;
  errorCode?: string | undefined;
  username?: string | undefined;
  at?: string | undefined;
  trailDocument?: string | undefined;
}): JSONObject {
  const trail: JSONObject = {
    awsRegion: "us-east-1",
    eventSource: "ecs.amazonaws.com",
    eventName: "UpdateService",
  };

  if (data.requestParameters !== undefined) {
    trail["requestParameters"] = data.requestParameters as JSONObject;
  }

  if (data.errorCode) {
    trail["errorCode"] = data.errorCode;
  }

  return {
    EventId: data.id,
    EventName: "UpdateService",
    EventSource: "ecs.amazonaws.com",
    // In seconds, as LookupEvents answers.
    EventTime: Date.parse(data.at || "2026-11-06T10:00:00Z") / 1000,
    Username: data.username || AUTOSCALING_SESSION,
    Resources: [
      { ResourceType: "AWS::ECS::Service", ResourceName: SERVICE_ARN },
    ],
    CloudTrailEvent:
      data.trailDocument !== undefined
        ? data.trailDocument
        : JSON.stringify(trail),
  };
}

function readEvent(event: JSONObject): CloudChange {
  const change: CloudChange | null = readAwsTrailEvent({
    event,
    accountId: ACCOUNT,
    region: "us-east-1",
  });

  expect(change).not.toBeNull();
  return change as CloudChange;
}

function change(overrides: Partial<CloudChange> = {}): CloudChange {
  return {
    kind: "change",
    provider: CloudProvider.AWS,
    accountId: ACCOUNT,
    region: "us-east-1",
    time: new Date("2026-11-06T10:00:00Z"),
    eventId: "evt-1",
    operation: "ecs:UpdateService",
    actor: AUTOSCALING_SESSION,
    resources: [{ id: SERVICE_ARN, type: "AWS::ECS::Service" }],
    failed: false,
    ...overrides,
  };
}

describe("which ECS UpdateService only scales", () => {
  test("one that names the service and sets its desired count: Application Auto Scaling, the CLI, the Cloud AI agent", () => {
    for (const requestParameters of [
      // Application Auto Scaling, and `aws ecs update-service --cluster --service --desired-count`.
      { cluster: "prod", service: "checkout", desiredCount: DESIRED_COUNT },
      // The default cluster: no cluster named.
      { service: "checkout", desiredCount: DESIRED_COUNT },
      // Only the count, as a trimmed record has it.
      { desiredCount: DESIRED_COUNT },
      // Terraform sends forceNewDeployment with every update: false starts nothing.
      {
        cluster: "prod",
        service: "checkout",
        desiredCount: DESIRED_COUNT,
        forceNewDeployment: false,
      },
      // A count of none is still a count: scaled to zero.
      { cluster: "prod", service: "checkout", desiredCount: 0 },
    ]) {
      expect({
        requestParameters,
        scales: isAwsScaleOnlyUpdate("ecs:UpdateService", {
          requestParameters,
        }),
      }).toEqual({ requestParameters, scales: true });
    }
  });

  test("one that starts a deployment is a deploy, whatever count it sets beside it", () => {
    for (const requestParameters of [
      // A new task definition: the deploy UpdateService is made for.
      {
        cluster: "prod",
        service: "checkout",
        taskDefinition: "checkout:42",
        desiredCount: DESIRED_COUNT,
      },
      { cluster: "prod", service: "checkout", taskDefinition: "checkout:42" },
      // A forced deployment: the same revision rolled out again.
      {
        cluster: "prod",
        service: "checkout",
        desiredCount: DESIRED_COUNT,
        forceNewDeployment: true,
      },
      // Not a plain false: never read as one.
      {
        service: "checkout",
        desiredCount: DESIRED_COUNT,
        forceNewDeployment: "false",
      },
      // What the console's form sends with the count: the whole service again.
      {
        cluster: "prod",
        service: "checkout",
        desiredCount: DESIRED_COUNT,
        taskDefinition: "checkout:41",
        capacityProviderStrategy: [],
        deploymentConfiguration: { maximumPercent: 200 },
        networkConfiguration: { awsvpcConfiguration: { subnets: [] } },
        platformVersion: "LATEST",
        forceNewDeployment: false,
      },
      {
        service: "checkout",
        desiredCount: DESIRED_COUNT,
        loadBalancers: [],
      },
      {
        service: "checkout",
        desiredCount: DESIRED_COUNT,
        healthCheckGracePeriodSeconds: 60,
      },
      // No count at all.
      { cluster: "prod", service: "checkout" },
      { cluster: "prod", service: "checkout", forceNewDeployment: false },
    ]) {
      expect({
        requestParameters,
        scales: isAwsScaleOnlyUpdate("ecs:UpdateService", {
          requestParameters: requestParameters as unknown as JSONObject,
        }),
      }).toEqual({ requestParameters, scales: false });
    }
  });

  test("a request that is not there, or not an object, says nothing about scaling", () => {
    for (const trail of [
      {},
      { requestParameters: null },
      { requestParameters: "desiredCount" },
      { requestParameters: ["desiredCount"] },
      { requestParameters: {} },
    ]) {
      expect(
        isAwsScaleOnlyUpdate(
          "ecs:UpdateService",
          trail as unknown as JSONObject,
        ),
      ).toBe(false);
    }
  });

  test("only ECS UpdateService: another operation that sets a desired count is judged by its own name", () => {
    const requestParameters: JSONObject = {
      cluster: "prod",
      service: "checkout",
      desiredCount: DESIRED_COUNT,
    };

    for (const operation of [
      "ecs:CreateService",
      "ecs:UpdateServicePrimaryTaskSet",
      "autoscaling:UpdateAutoScalingGroup",
      "ecs:updateservice",
      "UpdateService",
      "",
    ]) {
      expect({
        operation,
        scales: isAwsScaleOnlyUpdate(operation, { requestParameters }),
      }).toEqual({ operation, scales: false });
    }
  });
});

describe("a CloudTrail event read as a change", () => {
  test("a scale-only update says so, and keeps none of its request", () => {
    const read: CloudChange = readEvent(
      updateServiceEvent({
        id: "evt-scale",
        requestParameters: {
          cluster: "prod",
          service: "checkout",
          desiredCount: DESIRED_COUNT,
        },
      }),
    );

    expect(read).toEqual({
      kind: "change",
      provider: CloudProvider.AWS,
      accountId: ACCOUNT,
      region: "us-east-1",
      time: new Date("2026-11-06T10:00:00Z"),
      eventId: "evt-scale",
      operation: "ecs:UpdateService",
      actor: AUTOSCALING_SESSION,
      resources: [{ id: SERVICE_ARN, type: "AWS::ECS::Service" }],
      failed: false,
      isScalingOnly: true,
    });

    const kept: string = JSON.stringify(read);
    expect(kept).not.toContain(String(DESIRED_COUNT));
    expect(kept).not.toContain("desiredCount");
    expect(kept).not.toContain('"prod"');
  });

  test("a deploy keeps the shape every change has: no word about scaling, none of its request", () => {
    const read: CloudChange = readEvent(
      updateServiceEvent({
        id: "evt-deploy",
        username: "GitHubActions",
        requestParameters: {
          cluster: "prod",
          service: "checkout",
          taskDefinition: "checkout:42",
        },
      }),
    );

    expect(Object.keys(read)).not.toContain("isScalingOnly");
    expect(JSON.stringify(read)).not.toContain("checkout:42");
    expect(JSON.stringify(read)).not.toContain("taskDefinition");
  });

  test("a scale-only update that failed is still scaling, and says it failed", () => {
    const read: CloudChange = readEvent(
      updateServiceEvent({
        id: "evt-scale-failed",
        errorCode: "AccessDeniedException",
        requestParameters: { service: "checkout", desiredCount: DESIRED_COUNT },
      }),
    );

    expect(read.failed).toBe(true);
    expect(read.isScalingOnly).toBe(true);
    expect(classifyCloudChange(read)).toBe(ChangeEventType.Scaling);
  });

  test("an unreadable trail document is a deploy, as before: nothing says it only scaled", () => {
    for (const trailDocument of ["not json", "", "[]", "null"]) {
      const read: CloudChange = readEvent(
        updateServiceEvent({ id: "evt-unreadable", trailDocument }),
      );

      expect(read.isScalingOnly).toBeUndefined();
      expect(classifyCloudChange(read)).toBe(ChangeEventType.Deployment);
    }
  });

  test("another service's operation with a desired count is not read for scaling", () => {
    const read: CloudChange | null = readAwsTrailEvent({
      event: {
        EventId: "evt-asg",
        EventName: "CreateAutoScalingGroup",
        EventSource: "autoscaling.amazonaws.com",
        EventTime: "2026-11-06T10:00:00Z",
        Username: "maya.lopez",
        CloudTrailEvent: JSON.stringify({
          awsRegion: "us-east-1",
          requestParameters: { desiredCapacity: DESIRED_COUNT },
        }),
      },
      accountId: ACCOUNT,
      region: "us-east-1",
    });

    expect(read?.isScalingOnly).toBeUndefined();
    expect(classifyCloudChange(read as CloudChange)).toBe(
      ChangeEventType.ConfigChange,
    );
  });
});

describe("what kind of change it is", () => {
  test("a scale-only UpdateService is scaling, beside a real deploy made with the same call", () => {
    const scaled: CloudChange = readEvent(
      updateServiceEvent({
        id: "evt-scale",
        requestParameters: {
          cluster: "prod",
          service: "checkout",
          desiredCount: DESIRED_COUNT,
        },
      }),
    );
    const deployed: CloudChange = readEvent(
      updateServiceEvent({
        id: "evt-deploy",
        username: "GitHubActions",
        requestParameters: {
          cluster: "prod",
          service: "checkout",
          taskDefinition: "checkout:42",
          desiredCount: DESIRED_COUNT,
        },
      }),
    );
    const forced: CloudChange = readEvent(
      updateServiceEvent({
        id: "evt-restart",
        requestParameters: {
          cluster: "prod",
          service: "checkout",
          forceNewDeployment: true,
        },
      }),
    );

    expect([scaled, deployed, forced].map(classifyCloudChange)).toEqual([
      ChangeEventType.Scaling,
      ChangeEventType.Deployment,
      ChangeEventType.Deployment,
    ]);
  });

  test("said by its connector, scaling wins over the deploy its name reads as; a health event stays the provider's", () => {
    expect(classifyCloudChange(change({ isScalingOnly: true }))).toBe(
      ChangeEventType.Scaling,
    );
    expect(classifyCloudChange(change({ isScalingOnly: false }))).toBe(
      ChangeEventType.Deployment,
    );
    expect(classifyCloudChange(change())).toBe(ChangeEventType.Deployment);
    expect(
      classifyCloudChange(
        change({
          kind: "health",
          operation: "AWS_ECS_OPERATIONAL_ISSUE",
          isScalingOnly: true,
        }),
      ),
    ).toBe(ChangeEventType.ProviderEvent);
    // A rollback's name still says what it is.
    expect(
      classifyCloudChange(
        change({
          operation: "codedeploy:RollbackDeployment",
          isScalingOnly: true,
        }),
      ),
    ).toBe(ChangeEventType.Rollback);
  });

  test("the change event keeps the recorder's title and words, with scaling as its kind", () => {
    const resourceId: ObjectID = new ObjectID(
      "5e7a1b30-0000-4000-8000-0000000000c1",
    );
    const entry: ParsedChangeEventEntry = buildCloudChangeEntry({
      change: readEvent(
        updateServiceEvent({
          id: "evt-scale",
          requestParameters: {
            cluster: "prod",
            service: "checkout",
            desiredCount: DESIRED_COUNT,
          },
        }),
      ),
      resource: { id: resourceId, name: "checkout" },
      accountRecordId: null,
    });

    expect(entry.eventType).toBe(ChangeEventType.Scaling);
    expect(entry.title).toBe("ecs:UpdateService on checkout");
    expect(entry.description).toBe(
      `${AUTOSCALING_SESSION} ran ecs:UpdateService in account ${ACCOUNT} (us-east-1), on ${SERVICE_ARN}.`,
    );
    expect(JSON.stringify(entry)).not.toContain(String(DESIRED_COUNT));
    expect(JSON.stringify(entry.attributes)).not.toContain("isScalingOnly");
  });
});

describe("read from an AWS account's CloudTrail", () => {
  const NOW: Date = new Date("2026-11-06T10:07:00Z");

  beforeEach(() => {
    delete process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"];
    delete process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"];
    AssumedRoleCache.clear();
    AwsServerIdentity.clearCache();
  });

  test("Application Auto Scaling's update arrives as scaling, a pipeline's deploy of the same service as a deploy", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {
        "us-east-1": {
          metrics: [],
          trailEvents: [
            updateServiceEvent({
              id: "evt-scale-out",
              at: "2026-11-06T09:30:00Z",
              requestParameters: {
                cluster: "prod",
                service: "checkout",
                desiredCount: DESIRED_COUNT,
              },
            }),
            updateServiceEvent({
              id: "evt-deploy",
              at: "2026-11-06T09:40:00Z",
              username: "GitHubActions",
              requestParameters: {
                cluster: "prod",
                service: "checkout",
                taskDefinition: "checkout:42",
                forceNewDeployment: false,
              },
            }),
          ],
        },
      },
    });
    const state: CloudConnectionPullState = {
      accounts: [FAKE_ACCOUNT_ID],
      activePairs: ["us-east-1|AWS/ECS"],
    };

    const result: CloudChangesResult =
      await new AwsCloudConnector().readChanges(
        {
          provider: CloudProvider.AWS,
          projectId: "11111111-1111-4111-8111-111111111111",
          config: {
            authMethod: CloudConnectionAuthMethod.AwsAccessKey,
            accessKeyId: "AKIAIOSFODNN7EXAMPLE",
          },
          secrets: {
            secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
          },
        },
        {
          transport: fake.transport,
          now: () => {
            return NOW;
          },
          sleep: async () => {},
          state,
          connectionId: "33333333-3333-4333-8333-333333333333",
          budget: new CloudReadBudget({
            maxRequests: 300,
            maxDurationMs: 60000,
          }),
        },
      );

    const byId: Map<string, CloudChange> = new Map<string, CloudChange>(
      result.changes.map((read: CloudChange): [string, CloudChange] => {
        return [read.eventId, read];
      }),
    );

    expect(Array.from(byId.keys()).sort()).toEqual([
      "evt-deploy",
      "evt-scale-out",
    ]);
    expect(classifyCloudChange(byId.get("evt-scale-out")!)).toBe(
      ChangeEventType.Scaling,
    );
    expect(classifyCloudChange(byId.get("evt-deploy")!)).toBe(
      ChangeEventType.Deployment,
    );
    expect(JSON.stringify(result.changes)).not.toContain(String(DESIRED_COUNT));
  });
});
