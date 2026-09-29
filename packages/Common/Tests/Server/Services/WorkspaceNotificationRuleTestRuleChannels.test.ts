import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceUtil from "../../../Server/Utils/Workspace/Workspace";
import {
  WorkspaceChannel,
  WorkspaceSendMessageResponse,
} from "../../../Server/Utils/Workspace/WorkspaceBase";
import NotificationRuleWorkspaceChannel from "../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceProjectAuthToken, {
  MicrosoftTeamsMiscData,
} from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import WorkspaceNotificationLog from "../../../Models/DatabaseModels/WorkspaceNotificationLog";
import BaseNotificationRule from "../../../Types/Workspace/NotificationRules/BaseNotificationRule";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import WorkspaceMessagePayload from "../../../Types/Workspace/WorkspaceMessagePayload";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

/*
 * Tests for the CHANNEL half of WorkspaceNotificationRuleService.testRule — the
 * "Test Rule" button an admin presses to prove a workspace integration works.
 *
 * The bug these pin down: the loop that posted the test card into a channel the
 * test had just created was nested inside `if (shouldPostToExistingChannel)`. A
 * rule configured to CREATE a channel and not post to an existing one therefore
 * created the channel, invited nobody (a no-op on Teams) and returned success
 * having sent nothing at all.
 *
 * That is worse than a missing feature. The customer who reported the Microsoft
 * Teams roster failure used exactly this configuration as a control: "creating a
 * channel works, so the app must be installed correctly." It never posted, so it
 * proved nothing, and the real fault was looked for in the wrong place.
 *
 * The created-channel post was also addressed with `existingTeam` — a field
 * belonging to the OTHER half of the rule, undefined for a create-only rule and
 * potentially a different team when both halves are configured.
 */

const TEAM_A: string = "aaaaaaaa-1111-2222-3333-444444444444";
const TEAM_B: string = "bbbbbbbb-5555-6666-7777-888888888888";

interface RuleOverrides extends Partial<BaseNotificationRule> {
  shouldCreateNewChannel?: boolean;
  teamToCreateChannelIn?: string;
  newChannelTemplateName?: string;
}

function makeRule(data: {
  workspaceType?: WorkspaceType | undefined;
  overrides: RuleOverrides;
  name?: string | undefined;
}): WorkspaceNotificationRule {
  const rule: WorkspaceNotificationRule = new WorkspaceNotificationRule();
  rule.id = ObjectID.generate();
  rule.projectId = ObjectID.generate();
  rule.workspaceType = data.workspaceType || WorkspaceType.MicrosoftTeams;
  rule.eventType = NotificationRuleEventType.Alert;
  rule.name = data.name || "Test public channel Team";
  rule.notificationRule = {
    _type: "NotificationRule",
    filterCondition: FilterCondition.Any,
    filters: [],
    shouldPostToExistingChannel: false,
    existingChannelNames: "",
    shouldCreateNewChannel: false,
    ...data.overrides,
  } as BaseNotificationRule;
  return rule;
}

function makeCreatedChannel(data: {
  id: string;
  name: string;
  teamId?: string | undefined;
  workspaceType?: WorkspaceType | undefined;
}): NotificationRuleWorkspaceChannel {
  const channel: NotificationRuleWorkspaceChannel = {
    id: data.id,
    name: data.name,
    workspaceType: data.workspaceType || WorkspaceType.MicrosoftTeams,
    notificationRuleId: ObjectID.generate().toString(),
  };

  if (data.teamId) {
    channel.teamId = data.teamId;
  }

  return channel;
}

function makeSendResponse(data: {
  workspaceType?: WorkspaceType | undefined;
  threads?: Array<{ id: string; name: string; threadId: string }> | undefined;
  errors?: Array<{ id: string; name: string; error: string }> | undefined;
}): WorkspaceSendMessageResponse {
  const workspaceType: WorkspaceType =
    data.workspaceType || WorkspaceType.MicrosoftTeams;

  const response: WorkspaceSendMessageResponse = {
    workspaceType: workspaceType,
    threads: (data.threads || []).map(
      (thread: { id: string; name: string; threadId: string }) => {
        return {
          channel: {
            id: thread.id,
            name: thread.name,
            workspaceType: workspaceType,
          } as WorkspaceChannel,
          threadId: thread.threadId,
        };
      },
    ),
  };

  if (data.errors) {
    response.errors = data.errors.map(
      (error: { id: string; name: string; error: string }) => {
        return {
          channel: {
            id: error.id,
            name: error.name,
            workspaceType: workspaceType,
          } as WorkspaceChannel,
          error: error.error,
        };
      },
    );
  }

  return response;
}

interface Mocks {
  postSpy: jest.SpyInstance;
  createChannelsSpy: jest.SpyInstance;
  inviteUsersSpy: jest.SpyInstance;
  doesChannelExistSpy: jest.SpyInstance;
  createLogSpy: jest.SpyInstance;
}

const testByUserId: ObjectID = ObjectID.generate();

function mockDeps(data: {
  rule: WorkspaceNotificationRule;
  createdChannels?: Array<NotificationRuleWorkspaceChannel> | undefined;
  responses?: Array<WorkspaceSendMessageResponse> | undefined;
  channelExists?: boolean | undefined;
}): Mocks {
  jest
    .spyOn(WorkspaceNotificationRuleService, "findOneById")
    .mockResolvedValue(data.rule);

  const userAuth: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
  userAuth.workspaceUserId = "teams-user-1";
  jest
    .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
    .mockResolvedValue(userAuth);

  const projectAuth: WorkspaceProjectAuthToken =
    new WorkspaceProjectAuthToken();
  projectAuth.authToken = "project-auth-token";
  projectAuth.workspaceType = data.rule.workspaceType!;
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "findOneBy")
    .mockResolvedValue(projectAuth);

  const authWithMisc: WorkspaceProjectAuthToken =
    new WorkspaceProjectAuthToken();
  authWithMisc.miscData = {
    tenantId: "tenant-1",
    teamId: TEAM_A,
    teamName: "Test Team",
    botId: "bot-1",
  } as MicrosoftTeamsMiscData;
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockResolvedValue(authWithMisc);

  const createChannelsSpy: jest.SpyInstance = jest
    .spyOn(WorkspaceNotificationRuleService, "createChannelsBasedOnRules")
    .mockResolvedValue(data.createdChannels || []);

  const inviteUsersSpy: jest.SpyInstance = jest
    .spyOn(
      WorkspaceNotificationRuleService,
      "inviteUsersBasedOnRulesAndWorkspaceChannels",
    )
    .mockResolvedValue(undefined as never);

  const doesChannelExistSpy: jest.SpyInstance = jest
    .fn()
    .mockResolvedValue(
      data.channelExists === undefined ? true : data.channelExists,
    ) as unknown as jest.SpyInstance;

  jest.spyOn(WorkspaceUtil, "getWorkspaceTypeUtil").mockReturnValue({
    doesChannelExist: doesChannelExistSpy,
  } as never);

  const postSpy: jest.SpyInstance = jest
    .spyOn(WorkspaceUtil, "postMessageToAllWorkspaceChannelsAsBot")
    .mockResolvedValue(data.responses || []);

  const createLogSpy: jest.SpyInstance = jest
    .spyOn(WorkspaceNotificationLogService, "create")
    .mockResolvedValue(new WorkspaceNotificationLog());

  return {
    postSpy,
    createChannelsSpy,
    inviteUsersSpy,
    doesChannelExistSpy,
    createLogSpy,
  };
}

function runTestRule(rule: WorkspaceNotificationRule): Promise<void> {
  return WorkspaceNotificationRuleService.testRule({
    ruleId: rule.id!,
    projectId: ObjectID.generate(), // testRule overwrites this with rule.projectId.
    testByUserId: testByUserId,
    props: { isRoot: true },
  });
}

/*
 * The single payload handed to postMessageToAllWorkspaceChannelsAsBot on a
 * given call, for asserting destinations and teamId.
 */
function payloadOfCall(
  postSpy: jest.SpyInstance,
  callIndex: number,
): WorkspaceMessagePayload {
  const args: {
    messagePayloadsByWorkspace: Array<WorkspaceMessagePayload>;
  } = postSpy.mock.calls[callIndex]![0] as {
    messagePayloadsByWorkspace: Array<WorkspaceMessagePayload>;
  };

  return args.messagePayloadsByWorkspace[0]!;
}

beforeEach(() => {
  jest.restoreAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("testRule posts to channels it created, even when the rule posts nowhere else", () => {
  test("a create-only rule sends a test message", async () => {
    /*
     * THE regression test. Before the fix this asserted zero calls, silently,
     * and the Dashboard still showed a success modal.
     */
    const rule: WorkspaceNotificationRule = makeRule({
      overrides: {
        shouldCreateNewChannel: true,
        shouldPostToExistingChannel: false,
        teamToCreateChannelIn: TEAM_A,
        newChannelTemplateName: "test public channel",
      },
    });

    const mocks: Mocks = mockDeps({
      rule: rule,
      createdChannels: [
        makeCreatedChannel({
          id: "19:new-channel@thread.tacv2",
          name: "test-public-channel-ab12c",
          teamId: TEAM_A,
        }),
      ],
      responses: [
        makeSendResponse({
          threads: [
            {
              id: "19:new-channel@thread.tacv2",
              name: "test-public-channel-ab12c",
              threadId: "thread-1",
            },
          ],
        }),
      ],
    });

    await runTestRule(rule);

    expect(mocks.postSpy).toHaveBeenCalledTimes(1);
    expect(payloadOfCall(mocks.postSpy, 0).channelIds).toEqual([
      "19:new-channel@thread.tacv2",
    ]);
  });

  test("a create-only rule addresses the send with the team the channel was created in", async () => {
    /*
     * existingTeam belongs to the post-to-existing half of the rule and is
     * undefined here, so the send used to go out with no team at all.
     */
    const rule: WorkspaceNotificationRule = makeRule({
      overrides: {
        shouldCreateNewChannel: true,
        shouldPostToExistingChannel: false,
        teamToCreateChannelIn: TEAM_A,
      },
    });

    const mocks: Mocks = mockDeps({
      rule: rule,
      createdChannels: [
        makeCreatedChannel({
          id: "19:new@thread.tacv2",
          name: "oneuptime-alert-x",
          teamId: TEAM_A,
        }),
      ],
      responses: [makeSendResponse({})],
    });

    await runTestRule(rule);

    expect(payloadOfCall(mocks.postSpy, 0).teamId).toBe(TEAM_A);
  });

  test("the created channel's team wins over a DIFFERENT existingTeam on the same rule", async () => {
    /*
     * Both halves configured, naming two different teams. Addressing the created
     * channel with existingTeam pointed the send at a team that does not own it.
     */
    const rule: WorkspaceNotificationRule = makeRule({
      overrides: {
        shouldCreateNewChannel: true,
        shouldPostToExistingChannel: true,
        teamToCreateChannelIn: TEAM_A,
        existingTeam: TEAM_B,
        existingChannelNames: "general",
      },
    });

    const mocks: Mocks = mockDeps({
      rule: rule,
      createdChannels: [
        makeCreatedChannel({
          id: "19:new@thread.tacv2",
          name: "oneuptime-alert-x",
          teamId: TEAM_A,
        }),
      ],
      responses: [makeSendResponse({})],
    });

    await runTestRule(rule);

    expect(mocks.postSpy).toHaveBeenCalledTimes(2);
    expect(payloadOfCall(mocks.postSpy, 0).teamId).toBe(TEAM_A);
  });

  test("a create-only rule still creates the channel and invites the tester", async () => {
    const rule: WorkspaceNotificationRule = makeRule({
      overrides: {
        shouldCreateNewChannel: true,
        teamToCreateChannelIn: TEAM_A,
      },
    });

    const mocks: Mocks = mockDeps({
      rule: rule,
      createdChannels: [
        makeCreatedChannel({
          id: "19:new@thread.tacv2",
          name: "oneuptime-alert-x",
          teamId: TEAM_A,
        }),
      ],
      responses: [makeSendResponse({})],
    });

    await runTestRule(rule);

    expect(mocks.createChannelsSpy).toHaveBeenCalledTimes(1);
    expect(mocks.inviteUsersSpy).toHaveBeenCalledTimes(1);
  });

  test("a failed send to a created channel fails the test instead of reporting success", async () => {
    const rule: WorkspaceNotificationRule = makeRule({
      overrides: {
        shouldCreateNewChannel: true,
        teamToCreateChannelIn: TEAM_A,
      },
    });

    mockDeps({
      rule: rule,
      createdChannels: [
        makeCreatedChannel({
          id: "19:new@thread.tacv2",
          name: "oneuptime-alert-x",
          teamId: TEAM_A,
        }),
      ],
      responses: [
        makeSendResponse({
          errors: [
            {
              id: "19:new@thread.tacv2",
              name: "oneuptime-alert-x",
              error: "The bot is not part of the conversation roster.",
            },
          ],
        }),
      ],
    });

    await expect(runTestRule(rule)).rejects.toThrow(
      /Failed to send test message to some channels/,
    );
  });

  test("a failed send to a created channel is recorded in Notification Logs", async () => {
    const rule: WorkspaceNotificationRule = makeRule({
      overrides: {
        shouldCreateNewChannel: true,
        teamToCreateChannelIn: TEAM_A,
      },
    });

    const mocks: Mocks = mockDeps({
      rule: rule,
      createdChannels: [
        makeCreatedChannel({
          id: "19:new@thread.tacv2",
          name: "oneuptime-alert-x",
          teamId: TEAM_A,
        }),
      ],
      responses: [
        makeSendResponse({
          errors: [
            {
              id: "19:new@thread.tacv2",
              name: "oneuptime-alert-x",
              error: "boom",
            },
          ],
        }),
      ],
    });

    await expect(runTestRule(rule)).rejects.toThrow();
    expect(mocks.createLogSpy).toHaveBeenCalled();
  });

  test("a successful send to a created channel logs a Success entry", async () => {
    const rule: WorkspaceNotificationRule = makeRule({
      overrides: {
        shouldCreateNewChannel: true,
        teamToCreateChannelIn: TEAM_A,
      },
    });

    const mocks: Mocks = mockDeps({
      rule: rule,
      createdChannels: [
        makeCreatedChannel({
          id: "19:new@thread.tacv2",
          name: "oneuptime-alert-x",
          teamId: TEAM_A,
        }),
      ],
      responses: [
        makeSendResponse({
          threads: [
            {
              id: "19:new@thread.tacv2",
              name: "oneuptime-alert-x",
              threadId: "thread-7",
            },
          ],
        }),
      ],
    });

    await runTestRule(rule);

    const log: WorkspaceNotificationLog = mocks.createLogSpy.mock.calls[0]![0]
      .data as WorkspaceNotificationLog;
    expect(log.threadId).toBe("thread-7");
    expect(log.channelName).toBe("oneuptime-alert-x");
  });

  test("several created channels each get their own send", async () => {
    const rule: WorkspaceNotificationRule = makeRule({
      overrides: {
        shouldCreateNewChannel: true,
        teamToCreateChannelIn: TEAM_A,
      },
    });

    const mocks: Mocks = mockDeps({
      rule: rule,
      createdChannels: [
        makeCreatedChannel({
          id: "19:a@thread.tacv2",
          name: "a",
          teamId: TEAM_A,
        }),
        makeCreatedChannel({
          id: "19:b@thread.tacv2",
          name: "b",
          teamId: TEAM_A,
        }),
      ],
      responses: [makeSendResponse({})],
    });

    await runTestRule(rule);

    expect(mocks.postSpy).toHaveBeenCalledTimes(2);
    expect(payloadOfCall(mocks.postSpy, 0).channelIds).toEqual([
      "19:a@thread.tacv2",
    ]);
    expect(payloadOfCall(mocks.postSpy, 1).channelIds).toEqual([
      "19:b@thread.tacv2",
    ]);
  });

  test("a rule that creates nothing and posts nowhere sends nothing", async () => {
    // Not every empty rule should now start posting — only created channels did.
    const rule: WorkspaceNotificationRule = makeRule({
      overrides: {
        shouldCreateNewChannel: false,
        shouldPostToExistingChannel: false,
      },
    });

    const mocks: Mocks = mockDeps({ rule: rule, responses: [] });

    await runTestRule(rule);

    expect(mocks.postSpy).not.toHaveBeenCalled();
  });

  test("Slack create-only rules post too, and carry no teamId", async () => {
    const rule: WorkspaceNotificationRule = makeRule({
      workspaceType: WorkspaceType.Slack,
      overrides: { shouldCreateNewChannel: true },
    });

    const mocks: Mocks = mockDeps({
      rule: rule,
      createdChannels: [
        makeCreatedChannel({
          id: "C123",
          name: "oneuptime-alert-x",
          workspaceType: WorkspaceType.Slack,
        }),
      ],
      responses: [makeSendResponse({ workspaceType: WorkspaceType.Slack })],
    });

    await runTestRule(rule);

    expect(mocks.postSpy).toHaveBeenCalledTimes(1);
    // teamId is a Teams concept and must not be set on a Slack payload.
    expect(payloadOfCall(mocks.postSpy, 0).teamId).toBeUndefined();
  });
});

describe("testRule posting to existing channels is unchanged", () => {
  test("an existing-channel rule posts once per channel with the rule's team", async () => {
    const rule: WorkspaceNotificationRule = makeRule({
      overrides: {
        shouldPostToExistingChannel: true,
        existingTeam: TEAM_B,
        existingChannelNames: "general,test public channel",
      },
    });

    const mocks: Mocks = mockDeps({
      rule: rule,
      responses: [makeSendResponse({})],
    });

    await runTestRule(rule);

    expect(mocks.postSpy).toHaveBeenCalledTimes(2);
    expect(payloadOfCall(mocks.postSpy, 0).channelNames).toEqual(["general"]);
    expect(payloadOfCall(mocks.postSpy, 0).teamId).toBe(TEAM_B);
    expect(payloadOfCall(mocks.postSpy, 1).channelNames).toEqual([
      "test public channel",
    ]);
  });

  test("an existing channel that does not resolve fails the test before any send", async () => {
    const rule: WorkspaceNotificationRule = makeRule({
      overrides: {
        shouldPostToExistingChannel: true,
        existingTeam: TEAM_B,
        existingChannelNames: "typo-channel",
      },
    });

    const mocks: Mocks = mockDeps({
      rule: rule,
      channelExists: false,
      responses: [makeSendResponse({})],
    });

    await expect(runTestRule(rule)).rejects.toThrow(/does not exist/);
    expect(mocks.postSpy).not.toHaveBeenCalled();
  });

  test("existing channels are validated BEFORE the created-channel post runs", async () => {
    /*
     * Preserved ordering: a rule with both halves and a bad existing-channel
     * name must fail without having posted anything, so the test does not leave
     * a card in a freshly created channel and then report failure.
     */
    const rule: WorkspaceNotificationRule = makeRule({
      overrides: {
        shouldCreateNewChannel: true,
        teamToCreateChannelIn: TEAM_A,
        shouldPostToExistingChannel: true,
        existingTeam: TEAM_B,
        existingChannelNames: "typo-channel",
      },
    });

    const mocks: Mocks = mockDeps({
      rule: rule,
      createdChannels: [
        makeCreatedChannel({
          id: "19:new@thread.tacv2",
          name: "oneuptime-alert-x",
          teamId: TEAM_A,
        }),
      ],
      channelExists: false,
      responses: [makeSendResponse({})],
    });

    await expect(runTestRule(rule)).rejects.toThrow(/does not exist/);
    expect(mocks.postSpy).not.toHaveBeenCalled();
  });

  test("a Microsoft Teams existing-channel rule with no team selected is rejected", async () => {
    const rule: WorkspaceNotificationRule = makeRule({
      overrides: {
        shouldPostToExistingChannel: true,
        existingChannelNames: "general",
      },
    });

    const mocks: Mocks = mockDeps({
      rule: rule,
      responses: [makeSendResponse({})],
    });

    await expect(runTestRule(rule)).rejects.toThrow(
      /requires a team to be selected/,
    );
    expect(mocks.postSpy).not.toHaveBeenCalled();
  });

  test("created channels are posted to before existing ones", async () => {
    const rule: WorkspaceNotificationRule = makeRule({
      overrides: {
        shouldCreateNewChannel: true,
        teamToCreateChannelIn: TEAM_A,
        shouldPostToExistingChannel: true,
        existingTeam: TEAM_B,
        existingChannelNames: "general",
      },
    });

    const mocks: Mocks = mockDeps({
      rule: rule,
      createdChannels: [
        makeCreatedChannel({
          id: "19:new@thread.tacv2",
          name: "oneuptime-alert-x",
          teamId: TEAM_A,
        }),
      ],
      responses: [makeSendResponse({})],
    });

    await runTestRule(rule);

    expect(payloadOfCall(mocks.postSpy, 0).channelIds).toEqual([
      "19:new@thread.tacv2",
    ]);
    expect(payloadOfCall(mocks.postSpy, 1).channelNames).toEqual(["general"]);
  });
});
