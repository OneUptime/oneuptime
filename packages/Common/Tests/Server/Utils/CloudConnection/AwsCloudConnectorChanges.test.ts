import { beforeEach, describe, expect, test } from "@jest/globals";
import { AWS_CHANGE_MAX_PAGES } from "../../../../Server/Utils/CloudConnection/Aws/AwsChanges";
import AwsCloudConnector from "../../../../Server/Utils/CloudConnection/Aws/AwsCloudConnector";
import { AssumedRoleCache } from "../../../../Server/Utils/CloudConnection/Aws/AwsSts";
import AwsServerIdentity from "../../../../Server/Utils/CloudConnection/Aws/AwsServerIdentity";
import {
  CloudChange,
  CloudChangesOptions,
  CloudChangesResult,
  CloudConnectionPullState,
  CloudConnectionSettings,
  CloudReadBudget,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { CloudConnectionSetupScope } from "../../../../Types/CloudConnection/CloudConnectionSetupCommands";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import { JSONObject } from "../../../../Types/JSON";
import {
  FAKE_ACCOUNT_ID,
  FakeAws,
  FakeAwsOptions,
  awsError,
  createFakeAws,
} from "./FakeAwsApi";

/*
 * What changed in an AWS account, read from CloudTrail in each Region the
 * account is used in (and us-east-1, where IAM records its changes), and
 * what AWS Health says about it - against a fake AWS: each read starts a
 * little before the last one stopped and writes nothing twice, a Region
 * the account has not opted in to is nothing to read, a refusal is told
 * once, and an investigation's look back moves no cursor.
 */

const PROJECT: string = "11111111-1111-4111-8111-111111111111";
const CONNECTION: string = "33333333-3333-4333-8333-333333333333";
const MANAGEMENT: string = "123456789012";
const MEMBER: string = "210987654321";
const NO_ROLE: string = "333333333333";
const ROLE_ARN: string = `arn:aws:iam::${MANAGEMENT}:role/OneUptimeReadOnly-5f3a9c1e`;
const NOW: Date = new Date("2026-10-21T12:07:00Z");

const connector: AwsCloudConnector = new AwsCloudConnector();

function keySettings(config: JSONObject = {}): CloudConnectionSettings {
  return {
    provider: CloudProvider.AWS,
    projectId: PROJECT,
    config: {
      authMethod: CloudConnectionAuthMethod.AwsAccessKey,
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      ...config,
    },
    secrets: { secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
  };
}

function organizationSettings(): CloudConnectionSettings {
  return {
    provider: CloudProvider.AWS,
    projectId: PROJECT,
    config: {
      authMethod: CloudConnectionAuthMethod.AwsRole,
      roleArn: ROLE_ARN,
      readScope: CloudConnectionSetupScope.Organization,
    },
    secrets: {},
  };
}

function changeOptions(
  fake: FakeAws,
  state: CloudConnectionPullState,
  extra: Partial<CloudChangesOptions> = {},
  now: Date = NOW,
): CloudChangesOptions {
  return {
    transport: fake.transport,
    now: () => {
      return now;
    },
    sleep: async () => {},
    state,
    connectionId: CONNECTION,
    budget: new CloudReadBudget({ maxRequests: 300, maxDurationMs: 60000 }),
    ...extra,
  };
}

function trailEvent(data: {
  id: string;
  name: string;
  source: string;
  at: string;
  resources?: Array<{ type: string; name: string }> | undefined;
  trail?: JSONObject | undefined;
  username?: string | undefined;
}): JSONObject {
  return {
    EventId: data.id,
    EventName: data.name,
    EventSource: data.source,
    EventTime: Date.parse(data.at) / 1000,
    Username: data.username ?? "deploy-bot",
    Resources: (data.resources || []).map(
      (resource: { type: string; name: string }) => {
        return { ResourceType: resource.type, ResourceName: resource.name };
      },
    ),
    CloudTrailEvent: JSON.stringify({
      awsRegion: "eu-west-1",
      requestParameters: { environment: { DB_PASSWORD: "hunter2" } },
      ...(data.trail || {}),
    }),
  };
}

function singleAccountState(): CloudConnectionPullState {
  return { accounts: [FAKE_ACCOUNT_ID], activePairs: ["eu-west-1|AWS/EC2"] };
}

function operations(result: CloudChangesResult): Array<string> {
  return result.changes.map((change: CloudChange): string => {
    return change.operation;
  });
}

function fakeWith(options: Partial<FakeAwsOptions>): FakeAws {
  return createFakeAws({
    regions: {
      "eu-west-1": { metrics: [] },
      "us-east-1": { metrics: [] },
    },
    ...options,
  });
}

beforeEach(() => {
  delete process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"];
  delete process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"];
  AssumedRoleCache.clear();
  AwsServerIdentity.clearCache();
});

describe("what changed in an AWS account", () => {
  test("each Region the account is used in is read, and us-east-1 always, from two hours back", async () => {
    const fake: FakeAws = fakeWith({
      regions: {
        "eu-west-1": {
          metrics: [],
          trailEvents: [
            trailEvent({
              id: "evt-deploy",
              name: "UpdateFunctionCode20150331v2",
              source: "lambda.amazonaws.com",
              at: "2026-10-21T11:00:00Z",
              resources: [{ type: "AWS::Lambda::Function", name: "resize" }],
            }),
            // Machinery, not a change.
            trailEvent({
              id: "evt-assume",
              name: "AssumeRole",
              source: "sts.amazonaws.com",
              at: "2026-10-21T11:01:00Z",
            }),
            // Before the window.
            trailEvent({
              id: "evt-old",
              name: "RunInstances",
              source: "ec2.amazonaws.com",
              at: "2026-10-21T09:00:00Z",
            }),
          ],
        },
        "us-east-1": {
          metrics: [],
          trailEvents: [
            trailEvent({
              id: "evt-iam",
              name: "CreateRole",
              source: "iam.amazonaws.com",
              at: "2026-10-21T11:30:00Z",
              trail: { awsRegion: "us-east-1" },
            }),
          ],
        },
      },
    });
    const state: CloudConnectionPullState = singleAccountState();

    const result: CloudChangesResult = await connector.readChanges(
      keySettings(),
      changeOptions(fake, state),
    );

    expect(operations(result).sort()).toEqual([
      "iam:CreateRole",
      "lambda:UpdateFunctionCode20150331v2",
    ]);
    expect(result.complete).toBe(true);
    expect(result.warnings).toEqual([]);

    const deploy: CloudChange = result.changes.find((change: CloudChange) => {
      return change.eventId === "evt-deploy";
    })!;
    expect(deploy).toEqual({
      kind: "change",
      provider: CloudProvider.AWS,
      accountId: FAKE_ACCOUNT_ID,
      region: "eu-west-1",
      time: new Date("2026-10-21T11:00:00Z"),
      eventId: "evt-deploy",
      operation: "lambda:UpdateFunctionCode20150331v2",
      actor: "deploy-bot",
      resources: [{ id: "resize", type: "AWS::Lambda::Function" }],
      failed: false,
    });

    // The request's parameters are never kept.
    expect(JSON.stringify(result.changes)).not.toContain("hunter2");

    expect(
      fake.cloudTrailCalls
        .map((call: { region: string }): string => {
          return call.region;
        })
        .sort(),
    ).toEqual(["eu-west-1", "us-east-1"]);

    for (const call of fake.cloudTrailCalls) {
      expect(call.body["StartTime"]).toBe(
        Math.floor((NOW.getTime() - 2 * 60 * 60 * 1000) / 1000),
      );
      expect(call.body["EndTime"]).toBe(NOW.getTime() / 1000);
      expect(call.body["LookupAttributes"]).toEqual([
        { AttributeKey: "ReadOnly", AttributeValue: "false" },
      ]);
    }

    // Each Region's log, and AWS Health's, carries on from now.
    expect(state.changeCursors).toEqual({
      [`${FAKE_ACCOUNT_ID}|eu-west-1`]: NOW.toISOString(),
      [`${FAKE_ACCOUNT_ID}|us-east-1`]: NOW.toISOString(),
      [`${FAKE_ACCOUNT_ID}|health`]: NOW.toISOString(),
    });
  });

  test("the next read starts twenty minutes before the last one stopped and writes nothing twice", async () => {
    const seen: JSONObject = trailEvent({
      id: "evt-a",
      name: "ModifyDBInstance",
      source: "rds.amazonaws.com",
      at: "2026-10-21T12:00:00Z",
    });
    const fake: FakeAws = fakeWith({
      regions: {
        "eu-west-1": { metrics: [], trailEvents: [seen] },
        "us-east-1": { metrics: [] },
      },
    });
    const state: CloudConnectionPullState = singleAccountState();

    const first: CloudChangesResult = await connector.readChanges(
      keySettings(),
      changeOptions(fake, state),
    );
    expect(operations(first)).toEqual(["rds:ModifyDBInstance"]);

    // CloudTrail delivers the next one late; the same event is listed again.
    const later: Date = new Date("2026-10-21T12:12:00Z");
    const fakeLater: FakeAws = fakeWith({
      regions: {
        "eu-west-1": {
          metrics: [],
          trailEvents: [
            seen,
            trailEvent({
              id: "evt-b",
              name: "UpdateService",
              source: "ecs.amazonaws.com",
              at: "2026-10-21T12:05:00Z",
            }),
          ],
        },
        "us-east-1": { metrics: [] },
      },
    });

    const second: CloudChangesResult = await connector.readChanges(
      keySettings(),
      changeOptions(fakeLater, state, {}, later),
    );

    expect(operations(second)).toEqual(["ecs:UpdateService"]);
    expect(fakeLater.cloudTrailCalls[0]!.body["StartTime"]).toBe(
      Math.floor((NOW.getTime() - 20 * 60 * 1000) / 1000),
    );
    expect(state.changeCursors?.[`${FAKE_ACCOUNT_ID}|eu-west-1`]).toBe(
      later.toISOString(),
    );
  });

  test("a Region the account has not opted in to has nothing to read", async () => {
    const fake: FakeAws = fakeWith({});

    const result: CloudChangesResult = await connector.readChanges(
      keySettings({ regions: "eu-west-1,ap-east-1" }),
      changeOptions(fake, { accounts: [FAKE_ACCOUNT_ID] }),
    );

    expect(result.warnings).toEqual([]);
    expect(
      fake.cloudTrailCalls
        .map((call: { region: string }): string => {
          return call.region;
        })
        .sort(),
    ).toEqual(["eu-west-1", "us-east-1"]);
  });

  test("a credential refused in us-east-1 is refused: the read fails", async () => {
    const fake: FakeAws = fakeWith({
      regions: {
        "eu-west-1": { metrics: [] },
        "us-east-1": {
          metrics: [],
          trailError: awsError(
            400,
            "InvalidClientTokenId",
            "The security token included in the request is invalid.",
          ),
        },
      },
    });

    let failure: unknown = null;

    try {
      await connector.readChanges(
        keySettings(),
        changeOptions(fake, singleAccountState()),
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(LlmProviderError);
    expect((failure as LlmProviderError).kind).toBe(
      CloudConnectionFailureKind.Authentication,
    );
  });

  test("a role that may not read CloudTrail is told once, and keeps its cursor", async () => {
    const refused: ReturnType<typeof awsError> = awsError(
      400,
      "AccessDeniedException",
      "User is not authorized to perform: cloudtrail:LookupEvents",
    );
    const fake: FakeAws = fakeWith({
      regions: {
        "eu-west-1": { metrics: [], trailError: refused },
        "us-east-1": { metrics: [], trailError: refused },
      },
    });
    const state: CloudConnectionPullState = singleAccountState();

    const result: CloudChangesResult = await connector.readChanges(
      keySettings(),
      changeOptions(fake, state),
    );

    expect(result.changes).toEqual([]);
    expect(result.complete).toBe(false);
    expect(result.warnings).toEqual([
      "The role may not read CloudTrail (cloudtrail:LookupEvents). Run the setup command again to allow it.",
    ]);
    expect(state.changeCursors?.[`${FAKE_ACCOUNT_ID}|eu-west-1`]).toBe(
      undefined,
    );
    expect(state.changeCursors?.[`${FAKE_ACCOUNT_ID}|us-east-1`]).toBe(
      undefined,
    );
  });

  test("a Region with more changes than one read takes keeps its newest, moves on, and says so", async () => {
    const events: Array<JSONObject> = [];

    for (let index: number = 0; index < 12; index++) {
      events.push(
        trailEvent({
          id: `evt-${index}`,
          name: "PutBucketPolicy",
          source: "s3.amazonaws.com",
          at: new Date(
            Date.parse("2026-10-21T11:00:00Z") + index * 60000,
          ).toISOString(),
        }),
      );
    }

    const fake: FakeAws = fakeWith({
      regions: {
        "eu-west-1": { metrics: [], trailEvents: events, trailPageSize: 2 },
        "us-east-1": { metrics: [] },
      },
    });
    const state: CloudConnectionPullState = singleAccountState();

    const result: CloudChangesResult = await connector.readChanges(
      keySettings(),
      changeOptions(fake, state),
    );

    // Every page it could read was read: the read itself is not cut short.
    expect(result.complete).toBe(true);
    // The newest pages, as CloudTrail lists them.
    expect(result.changes).toHaveLength(AWS_CHANGE_MAX_PAGES * 2);
    expect(
      result.changes
        .map((change: CloudChange): string => {
          return change.eventId;
        })
        .sort(),
    ).toEqual(
      [
        "evt-2",
        "evt-3",
        "evt-4",
        "evt-5",
        "evt-6",
        "evt-7",
        "evt-8",
        "evt-9",
        "evt-10",
        "evt-11",
      ].sort(),
    );
    expect(
      fake.cloudTrailCalls.filter((call: { region: string }): boolean => {
        return call.region === "eu-west-1";
      }),
    ).toHaveLength(AWS_CHANGE_MAX_PAGES);
    // Before: the cursor stayed, and every read read the same newest pages.
    expect(state.changeCursors?.[`${FAKE_ACCOUNT_ID}|eu-west-1`]).toBe(
      NOW.toISOString(),
    );
    expect(state.changeCursors?.[`${FAKE_ACCOUNT_ID}|us-east-1`]).toBe(
      NOW.toISOString(),
    );
    expect(result.warnings).toEqual([
      "More changed in eu-west-1 than one read takes: the newest changes are kept, and some older ones were left out.",
    ]);
    /*
     * What it read is older than where the next read starts - twenty
     * minutes before now - so nothing of it needs remembering.
     */
    expect(
      state.recentChanges?.[`${FAKE_ACCOUNT_ID}|eu-west-1`],
    ).toBeUndefined();

    // The next read, ten minutes on, reads from twenty minutes before this one.
    const later: FakeAws = fakeWith({
      regions: {
        "eu-west-1": { metrics: [], trailEvents: events, trailPageSize: 2 },
        "us-east-1": { metrics: [] },
      },
    });
    const next: CloudChangesResult = await connector.readChanges(
      keySettings(),
      changeOptions(later, state, {}, new Date(NOW.getTime() + 10 * 60000)),
    );

    expect(
      Number(
        later.cloudTrailCalls.find((call: { region: string }): boolean => {
          return call.region === "eu-west-1";
        })!.body["StartTime"],
      ),
    ).toBe(Math.floor((NOW.getTime() - 20 * 60000) / 1000));
    // Nothing it wrote is written again.
    expect(next.changes).toEqual([]);
  });

  test("an investigation's look back reads only what it names, from its own start, and moves no cursor", async () => {
    const fake: FakeAws = fakeWith({
      regions: {
        "eu-west-1": {
          metrics: [],
          trailEvents: [
            trailEvent({
              id: "evt-old-deploy",
              name: "UpdateFunctionCode20150331v2",
              source: "lambda.amazonaws.com",
              at: "2026-10-21T06:00:00Z",
            }),
          ],
        },
        "eu-central-1": { metrics: [] },
        "us-east-1": { metrics: [] },
      },
    });
    const state: CloudConnectionPullState = {
      ...singleAccountState(),
      activePairs: ["eu-west-1|AWS/EC2", "eu-central-1|AWS/EC2"],
    };
    const since: Date = new Date("2026-10-21T05:00:00Z");

    const result: CloudChangesResult = await connector.readChanges(
      keySettings(),
      changeOptions(fake, state, {
        since,
        only: [{ accountId: FAKE_ACCOUNT_ID, regions: ["eu-west-1"] }],
      }),
    );

    expect(operations(result)).toEqual(["lambda:UpdateFunctionCode20150331v2"]);
    expect(
      fake.cloudTrailCalls
        .map((call: { region: string }): string => {
          return call.region;
        })
        .sort(),
    ).toEqual(["eu-west-1", "us-east-1"]);
    expect(fake.cloudTrailCalls[0]!.body["StartTime"]).toBe(
      since.getTime() / 1000,
    );
    expect(state.changeCursors).toBeUndefined();
    expect(state.recentChanges).toBeUndefined();
    // Health is never part of a look back.
    expect(fake.healthCalls).toEqual([]);
  });

  test("an account the look back does not name is not read", async () => {
    const fake: FakeAws = fakeWith({});

    const result: CloudChangesResult = await connector.readChanges(
      keySettings(),
      changeOptions(fake, singleAccountState(), {
        since: new Date("2026-10-21T05:00:00Z"),
        only: [{ accountId: "999999999999" }],
      }),
    );

    expect(result.changes).toEqual([]);
    expect(fake.cloudTrailCalls).toEqual([]);
  });
});

describe("what AWS Health says about the account", () => {
  const ISSUE_ARN: string =
    "arn:aws:health:eu-west-1::event/EC2/AWS_EC2_OPERATIONAL_ISSUE/abc";

  test("its issues are read every fifteen minutes, in AWS's own words", async () => {
    const fake: FakeAws = fakeWith({
      healthEvents: [
        {
          arn: ISSUE_ARN,
          eventTypeCode: "AWS_EC2_OPERATIONAL_ISSUE",
          region: "eu-west-1",
          statusCode: "open",
          lastUpdatedTime: Date.parse("2026-10-21T11:40:00Z") / 1000,
        },
      ],
      healthDescriptions: {
        [ISSUE_ARN]: "We are investigating increased API error rates.",
      },
    });
    const state: CloudConnectionPullState = singleAccountState();

    const result: CloudChangesResult = await connector.readChanges(
      keySettings(),
      changeOptions(fake, state),
    );

    const health: Array<CloudChange> = result.changes.filter(
      (change: CloudChange): boolean => {
        return change.kind === "health";
      },
    );

    expect(health).toEqual([
      {
        kind: "health",
        provider: CloudProvider.AWS,
        accountId: FAKE_ACCOUNT_ID,
        region: "eu-west-1",
        time: new Date("2026-10-21T11:40:00Z"),
        eventId: `${ISSUE_ARN}|open|2026-10-21T11:40:00.000Z`,
        operation: "AWS_EC2_OPERATIONAL_ISSUE",
        actor: "",
        resources: [],
        failed: false,
        title: "AWS Health: EC2 operational issue (open)",
        description: "We are investigating increased API error rates.",
      },
    ]);
    expect(state.healthReadAt).toBe(NOW.toISOString());
    expect(
      fake.healthCalls.map((call: { action: string }): string => {
        return call.action;
      }),
    ).toEqual(["DescribeEvents", "DescribeEventDetails"]);

    // Five minutes later it is not due.
    const again: FakeAws = fakeWith({});
    await connector.readChanges(
      keySettings(),
      changeOptions(again, state, {}, new Date(NOW.getTime() + 5 * 60000)),
    );
    expect(again.healthCalls).toEqual([]);
  });

  test("an account whose support plan has no Health API is asked again a day later", async () => {
    const fake: FakeAws = fakeWith({
      healthError: awsError(
        400,
        "SubscriptionRequiredException",
        "The AWS Premium Support Subscription is required to use this service.",
      ),
    });
    const state: CloudConnectionPullState = singleAccountState();

    const result: CloudChangesResult = await connector.readChanges(
      keySettings(),
      changeOptions(fake, state),
    );

    expect(result.warnings).toEqual([]);
    expect(state.healthPausedAccounts).toEqual({
      [FAKE_ACCOUNT_ID]: new Date(
        NOW.getTime() + 24 * 60 * 60 * 1000,
      ).toISOString(),
    });

    const later: FakeAws = fakeWith({});
    await connector.readChanges(
      keySettings(),
      changeOptions(later, state, {}, new Date(NOW.getTime() + 60 * 60000)),
    );
    expect(later.healthCalls).toEqual([]);

    // A day later it is asked again.
    const tomorrow: FakeAws = fakeWith({});
    await connector.readChanges(
      keySettings(),
      changeOptions(
        tomorrow,
        state,
        {},
        new Date(NOW.getTime() + 25 * 60 * 60000),
      ),
    );
    expect(tomorrow.healthCalls.length).toBeGreaterThan(0);
  });

  test("AWS Health is read from a little before where the account's last read got to", async () => {
    const fake: FakeAws = fakeWith({});
    const state: CloudConnectionPullState = {
      ...singleAccountState(),
      healthReadAt: new Date(NOW.getTime() - 20 * 60000).toISOString(),
      accountHealthReadAt: {
        [FAKE_ACCOUNT_ID]: new Date(NOW.getTime() - 20 * 60000).toISOString(),
      },
    };

    await connector.readChanges(keySettings(), changeOptions(fake, state));

    const describe: { body: JSONObject } = fake.healthCalls.find(
      (call: { action: string }): boolean => {
        return call.action === "DescribeEvents";
      },
    )!;
    const filter: JSONObject = describe.body["filter"] as JSONObject;
    expect(
      ((filter["lastUpdatedTimes"] as Array<JSONObject>)[0] as JSONObject)[
        "from"
      ],
    ).toBe(Math.floor((NOW.getTime() - 40 * 60000) / 1000));
    expect(state.accountHealthReadAt?.[FAKE_ACCOUNT_ID]).toBe(
      NOW.toISOString(),
    );
  });
});

describe("AWS's other partitions", () => {
  function govSettings(): CloudConnectionSettings {
    return keySettings({ regions: "us-gov-east-1" });
  }

  test("GovCloud's changes and health are read in GovCloud's home Region, never us-east-1", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {
        "us-gov-east-1": {
          metrics: [],
          trailEvents: [
            trailEvent({
              id: "evt-gov",
              name: "RunInstances",
              source: "ec2.amazonaws.com",
              at: "2026-10-21T11:50:00Z",
            }),
          ],
        },
        "us-gov-west-1": { metrics: [] },
      },
    });
    const state: CloudConnectionPullState = {
      accounts: [FAKE_ACCOUNT_ID],
    };

    const result: CloudChangesResult = await connector.readChanges(
      govSettings(),
      changeOptions(fake, state),
    );

    expect(
      Array.from(
        new Set(
          fake.cloudTrailCalls.map((call: { region: string }): string => {
            return call.region;
          }),
        ),
      ).sort(),
    ).toEqual(["us-gov-east-1", "us-gov-west-1"]);
    expect(
      fake.healthCalls.map((call: { region: string }): string => {
        return call.region;
      }),
    ).toEqual(["us-gov-west-1"]);
    expect(operations(result)).toEqual(["ec2:RunInstances"]);
  });

  test("a credential refused in GovCloud's home Region is refused", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {
        "us-gov-east-1": { metrics: [] },
        "us-gov-west-1": {
          metrics: [],
          trailError: awsError(
            400,
            "UnrecognizedClientException",
            "The security token included in the request is invalid.",
          ),
        },
      },
    });

    await expect(
      connector.readChanges(
        govSettings(),
        changeOptions(fake, { accounts: [FAKE_ACCOUNT_ID] }),
      ),
    ).rejects.toThrow(LlmProviderError);
  });
});

describe("what changed in an AWS Organization", () => {
  test("each account is read through its role; a member without it is skipped", async () => {
    process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"] = "AKIAONEUPTIMESERVER1";
    process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"] =
      "oneuptime-server-secret";

    const fake: FakeAws = createFakeAws({
      account: MANAGEMENT,
      refusedRoles: [`arn:aws:iam::${NO_ROLE}:role/OneUptimeReadOnly-5f3a9c1e`],
      regions: {
        "us-east-1": {
          metrics: [],
          trailEvents: [
            trailEvent({
              id: "evt-org",
              name: "CreateUser",
              source: "iam.amazonaws.com",
              at: "2026-10-21T11:30:00Z",
              trail: { awsRegion: "us-east-1" },
            }),
          ],
        },
      },
    });
    const state: CloudConnectionPullState = {
      organizationAccounts: [
        { id: MANAGEMENT, name: "Management" },
        { id: MEMBER, name: "Production" },
        { id: NO_ROLE, name: "Sandbox" },
      ],
      accountStates: {
        [MANAGEMENT]: { accounts: [MANAGEMENT] },
        [MEMBER]: { accounts: [MEMBER] },
      },
    };

    const result: CloudChangesResult = await connector.readChanges(
      organizationSettings(),
      changeOptions(fake, state),
    );

    expect(
      result.changes
        .map((change: CloudChange): string => {
          return change.accountId;
        })
        .sort(),
    ).toEqual([MANAGEMENT, MEMBER].sort());
    expect(
      Array.from(
        new Set(
          fake.cloudTrailCalls.map((call: { account: string }): string => {
            return call.account;
          }),
        ),
      ).sort(),
    ).toEqual([MANAGEMENT, MEMBER].sort());
    expect(Object.keys(state.changeCursors || {}).sort()).toEqual(
      [
        `${MANAGEMENT}|us-east-1`,
        `${MANAGEMENT}|health`,
        `${MEMBER}|us-east-1`,
        `${MEMBER}|health`,
      ].sort(),
    );
    // Each account read is marked, the one without its role included.
    expect(state.accountStates?.[MANAGEMENT]?.changesReadAt).toBe(
      NOW.toISOString(),
    );
    expect(state.accountStates?.[MEMBER]?.changesReadAt).toBe(
      NOW.toISOString(),
    );
  });

  test("the account read least recently goes first, so a read that stops at its limit reaches the rest", async () => {
    process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"] = "AKIAONEUPTIMESERVER1";
    process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"] =
      "oneuptime-server-secret";

    const fake: FakeAws = createFakeAws({
      account: MANAGEMENT,
      regions: { "us-east-1": { metrics: [] } },
    });
    const state: CloudConnectionPullState = {
      healthReadAt: NOW.toISOString(),
      organizationAccounts: [
        { id: MANAGEMENT, name: "Management" },
        { id: MEMBER, name: "Production" },
      ],
      accountStates: {
        [MANAGEMENT]: {
          accounts: [MANAGEMENT],
          changesReadAt: new Date(NOW.getTime() - 60000).toISOString(),
        },
        [MEMBER]: {
          accounts: [MEMBER],
          changesReadAt: new Date(NOW.getTime() - 3600000).toISOString(),
        },
      },
    };

    await connector.readChanges(
      organizationSettings(),
      changeOptions(fake, state),
    );

    expect(fake.cloudTrailCalls[0]!.account).toBe(MEMBER);
  });

  test("an account whose support plan has no Health API is paused alone; the others are still asked", async () => {
    process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"] = "AKIAONEUPTIMESERVER1";
    process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"] =
      "oneuptime-server-secret";

    const fake: FakeAws = createFakeAws({
      account: MANAGEMENT,
      regions: { "us-east-1": { metrics: [] } },
      healthErrorsByAccount: {
        [MEMBER]: awsError(
          400,
          "SubscriptionRequiredException",
          "The AWS Premium Support Subscription is required to use this service.",
        ),
      },
    });
    const state: CloudConnectionPullState = {
      organizationAccounts: [
        { id: MEMBER, name: "Production" },
        { id: MANAGEMENT, name: "Management" },
      ],
      accountStates: {
        [MANAGEMENT]: { accounts: [MANAGEMENT] },
        [MEMBER]: { accounts: [MEMBER] },
      },
    };

    await connector.readChanges(
      organizationSettings(),
      changeOptions(fake, state),
    );

    expect(Object.keys(state.healthPausedAccounts || {})).toEqual([MEMBER]);
    expect(
      fake.healthCalls
        .filter((call: { action: string }): boolean => {
          return call.action === "DescribeEvents";
        })
        .map((call: { account: string }): string => {
          return call.account;
        })
        .sort(),
    ).toEqual([MANAGEMENT, MEMBER].sort());
    expect(state.accountHealthReadAt?.[MANAGEMENT]).toBe(NOW.toISOString());
  });
});
