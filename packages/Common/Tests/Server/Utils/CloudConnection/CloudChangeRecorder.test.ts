import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import CloudAccountService from "../../../../Server/Services/CloudAccountService";
import ChangeEventService from "../../../../Server/Services/ChangeEventService";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import CloudChangeRecorder, {
  CloudResourceIndex,
  buildCloudChangeEntry,
  classifyCloudChange,
  getCloudChangeDedupToken,
} from "../../../../Server/Utils/CloudConnection/CloudChangeRecorder";
import { CloudChange } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import logger from "../../../../Server/Utils/Logger";
import TelemetryFanInWriter from "../../../../Server/Utils/Telemetry/TelemetryFanInWriter";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  ChangeEventAttribute,
  ChangeEventSource,
  ChangeEventStatus,
  ChangeEventType,
} from "../../../../Utils/Telemetry/ChangeEventFields";

/*
 * A cloud account's changes and its provider's health events, kept as
 * change events: project-wide, tied to the Cloud Resource they changed
 * when the connection holds it and to their Cloud Account, classified by
 * what the operation did, written in batches with a token that names
 * exactly the changes in them - and never failing the read.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5e7a1b30-0000-4000-8000-000000000001",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "5e7a1b30-0000-4000-8000-000000000002",
);
const ACCOUNT_ROW_ID: ObjectID = new ObjectID(
  "5e7a1b30-0000-4000-8000-000000000003",
);
const OTHER_RESOURCE_ID: ObjectID = new ObjectID(
  "5e7a1b30-0000-4000-8000-000000000004",
);
const ACCOUNT: string = "123456789012";
const FUNCTION_ARN: string = `arn:aws:lambda:eu-west-1:${ACCOUNT}:function:resize`;

function change(overrides: Partial<CloudChange> = {}): CloudChange {
  return {
    kind: "change",
    provider: CloudProvider.AWS,
    accountId: ACCOUNT,
    region: "eu-west-1",
    time: new Date("2026-10-21T11:00:00Z"),
    eventId: "evt-1",
    operation: "lambda:UpdateFunctionCode20150331v2",
    actor: "deploy-bot",
    resources: [{ id: "resize", type: "AWS::Lambda::Function" }],
    failed: false,
    ...overrides,
  };
}

interface Submission {
  rows: Array<JSONObject>;
  dedupToken: string | undefined;
}

let submissions: Array<Submission>;
let findResources: SpyInstance<typeof CloudResourceService.findBy>;
let findAccount: SpyInstance<typeof CloudAccountService.findAccount>;

function attributesOf(row: JSONObject): Dictionary<string> {
  return row["attributes"] as Dictionary<string>;
}

beforeEach(() => {
  submissions = [];

  findResources = jest.spyOn(CloudResourceService, "findBy").mockResolvedValue([
    {
      id: RESOURCE_ID,
      name: "resize",
      providerResourceId: FUNCTION_ARN,
      cloudResourceType: "AWS::Lambda::Function",
    },
  ] as never);
  findAccount = jest
    .spyOn(CloudAccountService, "findAccount")
    .mockResolvedValue({ id: ACCOUNT_ROW_ID } as never);

  jest.spyOn(TelemetryFanInWriter, "submit").mockImplementation((async (
    target: unknown,
    rows: Array<JSONObject>,
    options?: { dedupToken?: string | undefined },
  ) => {
    expect(target).toBe(ChangeEventService);
    submissions.push({ rows, dedupToken: options?.dedupToken });
    return { flushed: Promise.resolve() };
  }) as never);

  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what kind of change an operation is", () => {
  test("by its verb: a rollback, scaling, a deploy, else configuration", () => {
    expect(
      classifyCloudChange(change({ operation: "codedeploy:StopDeployment" })),
    ).toBe(ChangeEventType.Deployment);
    expect(
      classifyCloudChange(
        change({ operation: "autoscaling:SetDesiredCapacity" }),
      ),
    ).toBe(ChangeEventType.Scaling);
    expect(
      classifyCloudChange(
        change({ operation: "v1.compute.instanceGroupManagers.resize" }),
      ),
    ).toBe(ChangeEventType.Scaling);
    expect(
      classifyCloudChange(
        change({ operation: "Microsoft.Web/sites/deployments/write" }),
      ),
    ).toBe(ChangeEventType.Deployment);
    expect(
      classifyCloudChange(change({ operation: "ecs:UpdateService" })),
    ).toBe(ChangeEventType.Deployment);
    expect(
      classifyCloudChange(
        change({ operation: "cloudformation:RollbackStack" }),
      ),
    ).toBe(ChangeEventType.Rollback);
    expect(
      classifyCloudChange(
        change({ operation: "ec2:AuthorizeSecurityGroupIngress" }),
      ),
    ).toBe(ChangeEventType.ConfigChange);
  });

  test("a health event is the provider's own", () => {
    expect(
      classifyCloudChange(
        change({ kind: "health", operation: "AWS_EC2_OPERATIONAL_ISSUE" }),
      ),
    ).toBe(ChangeEventType.ProviderEvent);
  });
});

describe("one change as a change event", () => {
  test("names the operation, the resource and who ran it, tied to the resource and the account", () => {
    const entry: ReturnType<typeof buildCloudChangeEntry> =
      buildCloudChangeEntry({
        change: change(),
        resource: { id: RESOURCE_ID, name: "resize" },
        accountRecordId: ACCOUNT_ROW_ID,
      });

    expect(entry.title).toBe("lambda:UpdateFunctionCode20150331v2 on resize");
    expect(entry.description).toBe(
      `deploy-bot ran lambda:UpdateFunctionCode20150331v2 in account ${ACCOUNT} (eu-west-1), on resize.`,
    );
    expect(entry.eventType).toBe(ChangeEventType.Deployment);
    expect(entry.time).toEqual(new Date("2026-10-21T11:00:00Z"));
    expect(entry.attributes).toEqual({
      [ChangeEventAttribute.Source]: ChangeEventSource.Cloud,
      [ChangeEventAttribute.Status]: ChangeEventStatus.Succeeded,
      [ChangeEventAttribute.CloudProvider]: CloudProvider.AWS,
      [ChangeEventAttribute.CloudAccountId]: ACCOUNT,
      [ChangeEventAttribute.CloudRegion]: "eu-west-1",
      [ChangeEventAttribute.CloudOperation]:
        "lambda:UpdateFunctionCode20150331v2",
      [ChangeEventAttribute.CloudActor]: "deploy-bot",
      [ChangeEventAttribute.CloudEventId]: "evt-1",
      [ChangeEventAttribute.CloudResourceId]: "resize",
      [ChangeEventAttribute.ResourceType]: "CloudResource",
      [ChangeEventAttribute.ResourceId]: RESOURCE_ID.toString(),
      [ChangeEventAttribute.CloudAccountRecordId]: ACCOUNT_ROW_ID.toString(),
    });
  });

  test("a call that failed says so", () => {
    const entry: ReturnType<typeof buildCloudChangeEntry> =
      buildCloudChangeEntry({
        change: change({ failed: true, actor: "" }),
        resource: null,
        accountRecordId: null,
      });

    expect(entry.title).toBe(
      "Failed: lambda:UpdateFunctionCode20150331v2 on resize",
    );
    expect(entry.description).toContain("Someone tried to run");
    expect(entry.attributes[ChangeEventAttribute.Status]).toBe(
      ChangeEventStatus.Failed,
    );
    expect(entry.attributes[ChangeEventAttribute.ResourceId]).toBeUndefined();
    expect(
      entry.attributes[ChangeEventAttribute.CloudAccountRecordId],
    ).toBeUndefined();
  });

  test("a health event keeps the provider's title and words, and no status", () => {
    const entry: ReturnType<typeof buildCloudChangeEntry> =
      buildCloudChangeEntry({
        change: change({
          kind: "health",
          operation: "AWS_EC2_OPERATIONAL_ISSUE",
          actor: "",
          resources: [],
          title: "AWS Health: EC2 operational issue (open)",
          description: "We are investigating increased API error rates.",
        }),
        resource: null,
        accountRecordId: ACCOUNT_ROW_ID,
      });

    expect(entry.title).toBe("AWS Health: EC2 operational issue (open)");
    expect(entry.description).toBe(
      "We are investigating increased API error rates.",
    );
    expect(entry.eventType).toBe(ChangeEventType.ProviderEvent);
    expect(entry.attributes[ChangeEventAttribute.Source]).toBe(
      ChangeEventSource.CloudHealth,
    );
    expect(entry.attributes[ChangeEventAttribute.Status]).toBeUndefined();
  });

  test("a provider's long words are clamped to a change event's limits", () => {
    const entry: ReturnType<typeof buildCloudChangeEntry> =
      buildCloudChangeEntry({
        change: change({
          kind: "health",
          title: "x".repeat(2000),
          description: "y".repeat(20000),
          operation: "o".repeat(1000),
        }),
        resource: null,
        accountRecordId: null,
      });

    expect(entry.title.length).toBeLessThanOrEqual(500);
    expect(entry.description.length).toBeLessThanOrEqual(5000);
    expect(
      entry.attributes[ChangeEventAttribute.CloudOperation]!.length,
    ).toBeLessThanOrEqual(300);
  });
});

describe("the resources a change names", () => {
  const index: CloudResourceIndex = new CloudResourceIndex([
    {
      id: RESOURCE_ID,
      name: "resize",
      providerResourceId: FUNCTION_ARN,
      type: "AWS::Lambda::Function",
    },
    {
      id: OTHER_RESOURCE_ID,
      name: "web-1",
      providerResourceId:
        "//compute.googleapis.com/projects/acme-prod/zones/europe-west1-b/instances/web-1",
      type: "compute.googleapis.com/Instance",
    },
  ]);

  test("are found by their whole id, in any case", () => {
    expect(index.find({ id: FUNCTION_ARN.toUpperCase() })?.id).toBe(
      RESOURCE_ID,
    );
  });

  test("by their own name with their type, or alone", () => {
    expect(
      index.find({ id: "resize", type: "AWS::Lambda::Function" })?.id,
    ).toBe(RESOURCE_ID);
    expect(index.find({ id: "resize" })?.id).toBe(RESOURCE_ID);
  });

  test("a Google Cloud resource by its name without its service", () => {
    expect(
      index.find({
        id: "projects/acme-prod/zones/europe-west1-b/instances/web-1",
      })?.id,
    ).toBe(OTHER_RESOURCE_ID);
  });

  test("a short name two resources answer to is never guessed", () => {
    const twins: CloudResourceIndex = new CloudResourceIndex([
      {
        id: RESOURCE_ID,
        name: "orders",
        providerResourceId: `arn:aws:sqs:eu-west-1:${ACCOUNT}:orders`,
        type: "AWS::SQS::Queue",
      },
      {
        id: OTHER_RESOURCE_ID,
        name: "orders",
        providerResourceId: `arn:aws:sns:eu-west-1:${ACCOUNT}:orders`,
        type: "AWS::SNS::Topic",
      },
    ]);

    expect(twins.find({ id: "orders" })).toBeNull();
    expect(twins.find({ id: "orders", type: "AWS::SNS::Topic" })?.id).toBe(
      OTHER_RESOURCE_ID,
    );
  });

  test("an unknown or empty name is no resource", () => {
    expect(index.find({ id: "nothing-like-it" })).toBeNull();
    expect(index.find({ id: "  " })).toBeNull();
  });
});

describe("recording", () => {
  test("writes each change project-wide, tied to the resource and account the connection holds", async () => {
    const recorded: number = await CloudChangeRecorder.record({
      projectId: PROJECT_ID,
      provider: CloudProvider.AWS,
      changes: [
        change(),
        change({
          eventId: "evt-2",
          operation: "s3:PutBucketPolicy",
          resources: [{ id: "unknown-bucket" }],
        }),
      ],
    });

    expect(recorded).toBe(2);
    expect(submissions).toHaveLength(1);

    const [tied, untied] = submissions[0]!.rows;
    expect(tied!["projectId"]).toBe(PROJECT_ID.toString());
    expect(tied!["primaryEntityId"]).toBeUndefined();
    expect(attributesOf(tied!)[ChangeEventAttribute.ResourceId]).toBe(
      RESOURCE_ID.toString(),
    );
    expect(attributesOf(tied!)[ChangeEventAttribute.CloudAccountRecordId]).toBe(
      ACCOUNT_ROW_ID.toString(),
    );
    expect(attributesOf(untied!)[ChangeEventAttribute.ResourceId]).toBe(
      undefined,
    );
    expect(attributesOf(untied!)[ChangeEventAttribute.CloudResourceId]).toBe(
      "unknown-bucket",
    );

    // The account's resources were read once, as the system.
    expect(findResources).toHaveBeenCalledTimes(1);
    expect(
      (findResources.mock.calls[0]![0] as unknown as JSONObject)["props"],
    ).toEqual({ isRoot: true });
    expect(findAccount).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      provider: CloudProvider.AWS,
      accountId: ACCOUNT,
    });
  });

  test("writes in batches of two hundred, each with a token of exactly its changes", async () => {
    const many: Array<CloudChange> = [];

    for (let index: number = 0; index < 450; index++) {
      many.push(change({ eventId: `evt-${index}` }));
    }

    const recorded: number = await CloudChangeRecorder.record({
      projectId: PROJECT_ID,
      provider: CloudProvider.AWS,
      changes: many,
    });

    expect(recorded).toBe(450);
    expect(
      submissions.map((submission: Submission): number => {
        return submission.rows.length;
      }),
    ).toEqual([200, 200, 50]);

    const tokens: Array<string> = submissions.map(
      (submission: Submission): string => {
        return submission.dedupToken || "";
      },
    );
    expect(new Set(tokens).size).toBe(3);
    expect(tokens[0]).toBe(
      getCloudChangeDedupToken(PROJECT_ID, submissions[0]!.rows),
    );
    expect(
      tokens[0]!.startsWith(`cloud-change:${PROJECT_ID.toString()}:`),
    ).toBe(true);
  });

  test("the same changes make the same token; one more change makes another", () => {
    const row: (id: string) => JSONObject = (id: string): JSONObject => {
      return { attributes: { [ChangeEventAttribute.CloudEventId]: id } };
    };

    expect(getCloudChangeDedupToken(PROJECT_ID, [row("a"), row("b")])).toBe(
      getCloudChangeDedupToken(PROJECT_ID, [row("a"), row("b")]),
    );
    expect(getCloudChangeDedupToken(PROJECT_ID, [row("a"), row("b")])).not.toBe(
      getCloudChangeDedupToken(PROJECT_ID, [row("a"), row("b"), row("c")]),
    );
  });

  test("nothing to record reads nothing", async () => {
    expect(
      await CloudChangeRecorder.record({
        projectId: PROJECT_ID,
        provider: CloudProvider.AWS,
        changes: [],
      }),
    ).toBe(0);
    expect(findResources).not.toHaveBeenCalled();
    expect(submissions).toEqual([]);
  });

  test("never fails the read: a failure is logged and nothing is counted", async () => {
    findResources.mockRejectedValue(new Error("database is down"));

    const recorded: number = await CloudChangeRecorder.record({
      projectId: PROJECT_ID,
      provider: CloudProvider.AWS,
      changes: [change()],
    });

    expect(recorded).toBe(0);
    expect(logger.error).toHaveBeenCalled();
  });
});
