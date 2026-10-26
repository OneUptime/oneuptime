import { describe, expect, test } from "@jest/globals";
import {
  awsOperationOf,
  describeAwsHealthEventType,
  isAwsChangeNoise,
  readAwsTrailEvent,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsChanges";
import { readAzureActivityEvent } from "../../../../Server/Utils/CloudConnection/Azure/AzureChanges";
import { CloudChange } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import {
  readGcpAuditEntry,
  readGcpHealthEvent,
} from "../../../../Server/Utils/CloudConnection/Gcp/GcpChanges";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { JSONObject } from "../../../../Types/JSON";

/*
 * One activity log entry as a change, for each cloud: what is machinery
 * and not a change, what failed, which resource it names, and that
 * nothing of a request's body is ever kept.
 */

const ACCOUNT: string = "123456789012";

describe("an AWS CloudTrail event", () => {
  test("names its operation as service:Action", () => {
    expect(awsOperationOf("ec2.amazonaws.com", "RunInstances")).toBe(
      "ec2:RunInstances",
    );
    expect(awsOperationOf("lambda", "Invoke")).toBe("lambda:Invoke");
  });

  test("signing in, keys and agents reporting are machinery, not changes", () => {
    expect(isAwsChangeNoise("sts.amazonaws.com", "AssumeRole")).toBe(true);
    expect(isAwsChangeNoise("SIGNIN.amazonaws.com", "ConsoleLogin")).toBe(true);
    expect(isAwsChangeNoise("kms.amazonaws.com", "Decrypt")).toBe(true);
    expect(isAwsChangeNoise("ecs.amazonaws.com", "SubmitTaskStateChange")).toBe(
      true,
    );
    expect(isAwsChangeNoise("ec2.amazonaws.com", "CreateTags")).toBe(true);
    expect(isAwsChangeNoise("ec2.amazonaws.com", "TerminateInstances")).toBe(
      false,
    );
    expect(isAwsChangeNoise("iam.amazonaws.com", "AttachRolePolicy")).toBe(
      false,
    );
  });

  test("a failed call says so, in the Region it was made in, and its request is never kept", () => {
    const change: CloudChange | null = readAwsTrailEvent({
      event: {
        EventId: "e1",
        EventName: "DeleteDBInstance",
        EventSource: "rds.amazonaws.com",
        EventTime: "2026-10-21T11:00:00Z",
        Username: "alice",
        Resources: [
          { ResourceType: "AWS::RDS::DBInstance", ResourceName: "orders" },
          { ResourceType: "AWS::RDS::DBInstance", ResourceName: "" },
        ],
        CloudTrailEvent: JSON.stringify({
          awsRegion: "eu-central-1",
          errorCode: "AccessDenied",
          requestParameters: { masterUserPassword: "hunter2" },
        }),
      },
      accountId: ACCOUNT,
      region: "eu-west-1",
    });

    expect(change).toEqual({
      kind: "change",
      provider: CloudProvider.AWS,
      accountId: ACCOUNT,
      region: "eu-central-1",
      time: new Date("2026-10-21T11:00:00Z"),
      eventId: "e1",
      operation: "rds:DeleteDBInstance",
      actor: "alice",
      resources: [{ id: "orders", type: "AWS::RDS::DBInstance" }],
      failed: true,
    });
    expect(JSON.stringify(change)).not.toContain("hunter2");
  });

  test("an event with an unreadable trail document is read from what it lists", () => {
    const change: CloudChange | null = readAwsTrailEvent({
      event: {
        EventId: "e2",
        EventName: "PutBucketPolicy",
        EventSource: "s3.amazonaws.com",
        EventTime: 1792580400,
        CloudTrailEvent: "not json",
      },
      accountId: ACCOUNT,
      region: "eu-west-1",
    });

    expect(change?.region).toBe("eu-west-1");
    expect(change?.failed).toBe(false);
    expect(change?.resources).toEqual([]);
    expect(change?.time).toEqual(new Date(1792580400 * 1000));
  });

  test("an event without an id, a name or a time is not a change", () => {
    const base: JSONObject = {
      EventId: "e3",
      EventName: "RunInstances",
      EventSource: "ec2.amazonaws.com",
      EventTime: "2026-10-21T11:00:00Z",
    };

    for (const missing of ["EventId", "EventName", "EventTime"]) {
      const event: JSONObject = { ...base };
      delete event[missing];
      expect(
        readAwsTrailEvent({ event, accountId: ACCOUNT, region: "eu-west-1" }),
      ).toBeNull();
    }

    expect(
      readAwsTrailEvent({
        event: { ...base, EventTime: "yesterday" },
        accountId: ACCOUNT,
        region: "eu-west-1",
      }),
    ).toBeNull();
  });
});

describe("an AWS Health event type", () => {
  test("reads as words", () => {
    expect(describeAwsHealthEventType("AWS_EC2_OPERATIONAL_ISSUE")).toBe(
      "EC2 operational issue",
    );
    expect(describeAwsHealthEventType("AWS_RDS_PLANNED_LIFECYCLE_EVENT")).toBe(
      "RDS planned lifecycle event",
    );
    expect(describeAwsHealthEventType("AWS")).toBe("AWS");
    expect(describeAwsHealthEventType("")).toBe("");
  });
});

describe("an Azure Activity Log event", () => {
  const SUB: string = "d0cfe6b2-9ac0-4464-9919-dccaee2e48c0";

  function event(overrides: JSONObject): JSONObject {
    return {
      eventDataId: "a1",
      eventTimestamp: "2026-10-21T11:00:00Z",
      category: { value: "Administrative" },
      operationName: { value: "Microsoft.Compute/virtualMachines/write" },
      status: { value: "Succeeded" },
      caller: "bob@contoso.com",
      resourceId: `/subscriptions/${SUB}/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm-1`,
      ...overrides,
    };
  }

  test("a read, a validation or a listing of keys is not a change", () => {
    for (const operation of [
      "Microsoft.Compute/virtualMachines/read",
      "Microsoft.Resources/deployments/validate/action",
      "Microsoft.Storage/storageAccounts/listKeys/action",
    ]) {
      expect(
        readAzureActivityEvent({
          event: event({ operationName: { value: operation } }),
          subscriptionId: SUB,
        }),
      ).toBeNull();
    }
  });

  test("an operation that started or was accepted has not ended", () => {
    for (const status of ["Started", "Accepted"]) {
      expect(
        readAzureActivityEvent({
          event: event({ status: { value: status } }),
          subscriptionId: SUB,
        }),
      ).toBeNull();
    }
  });

  test("plain-text fields are read as well as Azure's { value } ones", () => {
    const change: CloudChange | null = readAzureActivityEvent({
      event: event({
        category: "Administrative",
        status: "Failed",
        operationName: "Microsoft.Sql/servers/databases/delete",
      }),
      subscriptionId: SUB,
    });

    expect(change?.operation).toBe("Microsoft.Sql/servers/databases/delete");
    expect(change?.failed).toBe(true);
  });

  test("a category it does not know, or an event without an id or time, is nothing", () => {
    expect(
      readAzureActivityEvent({
        event: event({ category: { value: "Autoscale" } }),
        subscriptionId: SUB,
      }),
    ).toBeNull();
    expect(
      readAzureActivityEvent({
        event: event({ eventDataId: "" }),
        subscriptionId: SUB,
      }),
    ).toBeNull();
    expect(
      readAzureActivityEvent({
        event: event({ eventTimestamp: "soon" }),
        subscriptionId: SUB,
      }),
    ).toBeNull();
  });

  test("Resource Health without statuses keeps its title; someone's action says so", () => {
    const change: CloudChange | null = readAzureActivityEvent({
      event: event({
        category: { value: "ResourceHealth" },
        properties: { title: "Rebooted by user", cause: "UserInitiated" },
      }),
      subscriptionId: SUB,
    });

    expect(change?.kind).toBe("health");
    expect(change?.title).toBe("Azure Resource Health: Rebooted by user");
    expect(change?.description).toBe(
      "Rebooted by user. Someone with access caused it.",
    );
  });
});

describe("a Google Cloud audit log entry", () => {
  function entry(overrides: JSONObject, payload: JSONObject = {}): JSONObject {
    return {
      insertId: "g1",
      timestamp: "2026-10-21T11:00:00Z",
      resource: {
        type: "cloud_run_revision",
        labels: { location: "europe-west1" },
      },
      protoPayload: {
        methodName: "google.cloud.run.v2.Services.UpdateService",
        serviceName: "run.googleapis.com",
        resourceName:
          "projects/acme-prod/locations/europe-west1/services/checkout",
        authenticationInfo: {
          principalEmail: "ci@acme.iam.gserviceaccount.com",
        },
        ...payload,
      },
      ...overrides,
    };
  }

  test("is a change to the resource its full name names", () => {
    const change: CloudChange | null = readGcpAuditEntry({
      entry: entry({}),
      projectId: "acme-prod",
    });

    expect(change).toEqual({
      kind: "change",
      provider: CloudProvider.GCP,
      accountId: "acme-prod",
      region: "europe-west1",
      time: new Date("2026-10-21T11:00:00Z"),
      eventId: "g1",
      operation: "google.cloud.run.v2.Services.UpdateService",
      actor: "ci@acme.iam.gserviceaccount.com",
      resources: [
        {
          id: "//run.googleapis.com/projects/acme-prod/locations/europe-west1/services/checkout",
          type: "cloud_run_revision",
        },
      ],
      failed: false,
    });
  });

  test("a resource named in full already keeps its name; a global one has no Region", () => {
    const change: CloudChange | null = readGcpAuditEntry({
      entry: entry(
        { resource: { type: "gcs_bucket", labels: { location: "global" } } },
        {
          serviceName: "storage.googleapis.com",
          methodName: "storage.setIamPermissions",
          resourceName: "//storage.googleapis.com/projects/_/buckets/assets",
        },
      ),
      projectId: "acme-prod",
    });

    expect(change?.resources[0]?.id).toBe(
      "//storage.googleapis.com/projects/_/buckets/assets",
    );
    expect(change?.region).toBe("");
  });

  test("a status of 0 is a call that succeeded; any other code one that failed", () => {
    expect(
      readGcpAuditEntry({
        entry: entry({}, { status: { code: 0 } }),
        projectId: "acme-prod",
      })?.failed,
    ).toBe(false);
    expect(
      readGcpAuditEntry({
        entry: entry(
          {},
          { status: { code: 9, message: "FAILED_PRECONDITION" } },
        ),
        projectId: "acme-prod",
      })?.failed,
    ).toBe(true);
  });

  test("reads, listings and operation polls are not changes", () => {
    for (const methodName of [
      "v1.compute.instances.get",
      "storage.objects.list",
      "google.longrunning.Operations.GetOperation",
      "v1.compute.projects.setCommonInstanceMetadata",
    ]) {
      expect(
        readGcpAuditEntry({
          entry: entry({}, { methodName }),
          projectId: "acme-prod",
        }),
      ).toBeNull();
    }
  });

  test("an entry without an id, a method or a time is nothing", () => {
    expect(
      readGcpAuditEntry({ entry: entry({ insertId: "" }), projectId: "p" }),
    ).toBeNull();
    expect(
      readGcpAuditEntry({
        entry: entry({}, { methodName: "" }),
        projectId: "p",
      }),
    ).toBeNull();
    expect(
      readGcpAuditEntry({ entry: entry({ timestamp: "x" }), projectId: "p" }),
    ).toBeNull();
  });
});

describe("a Google Cloud Service Health event", () => {
  test("without a title is named by the products it touches", () => {
    const change: CloudChange | null = readGcpHealthEvent({
      event: {
        name: "projects/p/locations/global/events/e1",
        startTime: "2026-10-21T10:00:00Z",
        state: "CLOSED",
        eventImpacts: [
          { product: { productName: "Cloud Run" } },
          { product: { productName: "Cloud Run" } },
          { product: {} },
        ],
      },
      projectId: "p",
    });

    expect(change?.title).toBe(
      "Google Cloud Service Health: Cloud Run (closed)",
    );
    expect(change?.description).toBe("Affects Cloud Run.");
    expect(change?.operation).toBe("INCIDENT");
    expect(change?.time).toEqual(new Date("2026-10-21T10:00:00Z"));
  });

  test("an event without a name or time is nothing", () => {
    expect(
      readGcpHealthEvent({
        event: { updateTime: "2026-10-21T10:00:00Z" },
        projectId: "p",
      }),
    ).toBeNull();
    expect(
      readGcpHealthEvent({ event: { name: "e" }, projectId: "p" }),
    ).toBeNull();
  });
});
