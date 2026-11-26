import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Project from "../../../../Models/DatabaseModels/Project";
import User from "../../../../Models/DatabaseModels/User";
import WorkspaceLiveMessage from "../../../../Models/DatabaseModels/WorkspaceLiveMessage";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import IncidentService from "../../../../Server/Services/IncidentService";
import ProjectService from "../../../../Server/Services/ProjectService";
import UserService from "../../../../Server/Services/UserService";
import WorkspaceLiveMessageService from "../../../../Server/Services/WorkspaceLiveMessageService";
import WorkspaceNotificationRuleService, {
  MessageBlocksByWorkspaceType,
} from "../../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import RemediationChatMessage, {
  RemediationChatFix,
  RemediationFixMessageState,
} from "../../../../Server/Utils/AutoRemediation/RemediationChatMessage";
import {
  getViewInProductTitle,
  REMEDIATION_CHAT_WORDS,
  TWO_APPROVALS_MESSAGE_NOTE,
} from "../../../../Server/Utils/AutoRemediation/RemediationChatWords";
import FeedWorkspaceNotificationUtil from "../../../../Server/Utils/Feed/FeedWorkspaceNotification";
import WorkspaceLiveMessages from "../../../../Server/Utils/Workspace/LiveMessages/WorkspaceLiveMessages";
import MicrosoftTeamsUtil from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import SlackActionType from "../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import WorkspaceUtil from "../../../../Server/Utils/Workspace/Workspace";
import { WorkspaceSendMessageResponse } from "../../../../Server/Utils/Workspace/WorkspaceBase";
import WorkspaceNotificationText from "../../../../Server/Utils/Workspace/WorkspaceNotificationText";
import URL from "../../../../Types/API/URL";
import {
  AiRemediationCommand,
  AiRemediationCommandPlan,
  AiRemediationCommandPlanUtil,
  AiRemediationCommandPolicyVerdict,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import { getRemediationPlanFingerprint } from "../../../../Types/AutoRemediation/RemediationPlanFingerprint";
import Email from "../../../../Types/Email";
import { KubectlCommandTier } from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import WorkspaceLiveMessageKey, {
  WorkspaceLiveMessageDestinationType,
} from "../../../../Types/Workspace/WorkspaceLiveMessageKey";
import WorkspaceMessagePayload, {
  WorkspaceMessageBlock,
  WorkspaceMessagePayloadButton,
  WorkspacePayloadButtons,
  WorkspacePayloadContext,
  WorkspacePayloadMarkdown,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import InMemoryLiveMessages from "../Workspace/LiveMessages/InMemoryLiveMessages";

jest.mock("../../../../Server/Utils/Logger");

/*
 * A FIX'S MESSAGE IN SLACK AND MICROSOFT TEAMS, EDITED WHERE IT WAS POSTED
 * (#6422).
 *
 * A fix that waits for approval is posted with its record's feed entry,
 * its changes and its buttons appended, wherever the record's messages go.
 * Those posts are kept (WorkspaceLiveMessages.keepPosts), each with the
 * entry's own blocks, under the fix's key, and edited in place as people
 * act on the fix (RemediationChatMessage.refreshKeptMessages):
 *
 *  - after the first of two approvals, the message names who gave it and
 *    says it runs once someone else approves it too; Review and approve
 *    and Dismiss stay, carrying the same fix and fingerprint;
 *  - after the approval that runs it, or a dismissal, those buttons go
 *    (View in OneUptime stays) and the message says who acted;
 *  - how the fix stands is read from its row while its messages are held,
 *    so two edits racing end on the newer; a first approval for another
 *    plan counts for nothing here, as it does for approving;
 *  - a message that went out as several posts, a post with no id, a post
 *    that failed are not kept; nothing a chat refuses fails an approval.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "64220000-0000-4000-8000-000000000001",
);
const SUGGESTION_ID: ObjectID = new ObjectID(
  "64220000-0000-4000-8000-000000000002",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "64220000-0000-4000-8000-000000000003",
);
const ANA_ID: ObjectID = new ObjectID("64220000-0000-4000-8000-0000000000aa");
const BEN_ID: ObjectID = new ObjectID("64220000-0000-4000-8000-0000000000bb");
const INCIDENT_URL: string =
  "https://oneuptime.example.com/dashboard/64220000-0000-4000-8000-000000000001/incidents/64220000-0000-4000-8000-000000000003";

const SLACK_CHANNEL: string = "C0INC42";
const TEAMS_CHANNEL: string = "19:inc42@thread.tacv2";
const TEAMS_TEAM: string = "team-sre";

const KEY: string = WorkspaceLiveMessageKey.forRemediationFix(SUGGESTION_ID);

const ENTRY: string =
  "⚡ **Incident #42: AI needs your approval for 1 change it did not run on its own.** Review the exact command(s) and reasoning, then approve with one click to run them.";

function markdown(text: string): WorkspacePayloadMarkdown {
  return { _type: "WorkspacePayloadMarkdown", text };
}

// A riskier kubectl change: two people approve it where the project asks.
function riskierChange(): AiRemediationCommand {
  return {
    sequence: 1,
    stepType: RunbookStepType.Kubectl,
    runnerId: "64220000-0000-4000-8000-000000000006",
    runnerNameSnapshot: "Kubernetes AI agent",
    kubernetesClusterId: "64220000-0000-4000-8000-000000000007",
    kubernetesClusterNameSnapshot: "prod-eu-west-1",
    kubectlTier: KubectlCommandTier.RiskyWrite,
    command: "kubectl rollout restart deployment/checkout-api -n checkout",
    timeoutInMs: 60000,
    rationale: "new pods read DB_POOL_MAX=40 again",
    expectedEffect: "the queue drains",
    policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
  };
}

const PLAN: AiRemediationCommandPlan = { commands: [riskierChange()] };

// The fix's row, as the database holds it now.
type Row = Record<string, unknown>;
let row: Row;

function waitingRow(): Row {
  return {
    _id: SUGGESTION_ID.toString(),
    id: SUGGESTION_ID,
    projectId: PROJECT_ID,
    incidentId: INCIDENT_ID,
    status: AutoRemediationSuggestionStatus.Suggested,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    commandPlan: AiRemediationCommandPlanUtil.toJSON(PLAN),
    verificationWindowMinutes: 15,
  };
}

function planFingerprint(): string {
  return getRemediationPlanFingerprint({
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    commandPlan: AiRemediationCommandPlanUtil.toJSON(PLAN),
  });
}

function firstApprovedBy(userId: ObjectID): void {
  row["firstApprovedByUserId"] = userId;
  row["firstApprovedAt"] = new Date();
  row["firstApprovedPlanFingerprint"] = planFingerprint();
}

function approvedBy(userId: ObjectID): void {
  row["status"] = AutoRemediationSuggestionStatus.Approved;
  row["approvedByUserId"] = userId;
  row["approvedAt"] = new Date();
}

function dismissedBy(userId: ObjectID): void {
  row["status"] = AutoRemediationSuggestionStatus.Dismissed;
  row["dismissedByUserId"] = userId;
  row["dismissedAt"] = new Date();
}

function suggestionOf(fields: Row): AutoRemediationSuggestion {
  return Object.assign(new AutoRemediationSuggestion(), fields);
}

function person(name: string, email?: string): User {
  const user: User = new User();
  user.name = new Name(name);

  if (email) {
    user.email = new Email(email);
  }

  return user;
}

function fixNow(): RemediationChatFix {
  return RemediationChatMessage.fromSuggestion(suggestionOf(row))!;
}

function auth(workspaceType: WorkspaceType): WorkspaceProjectAuthToken {
  const token: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
  token.projectId = PROJECT_ID;
  token.workspaceType = workspaceType;
  token.authToken = `${workspaceType}-token`;
  return token;
}

// Where the record's messages go: a Slack channel and a Teams channel.
function destinationOf(workspaceType: WorkspaceType): WorkspaceMessagePayload {
  return workspaceType === WorkspaceType.Slack
    ? {
        _type: "WorkspaceMessagePayload",
        workspaceType,
        messageBlocks: [],
        channelNames: [],
        channelIds: [SLACK_CHANNEL],
      }
    : {
        _type: "WorkspaceMessagePayload",
        workspaceType,
        messageBlocks: [],
        channelNames: [],
        channelIds: [TEAMS_CHANNEL],
        teamId: TEAMS_TEAM,
      };
}

// Each channel a payload names took one post, with an id.
function postedEverywhere(data: {
  messagePayloadsByWorkspace: Array<WorkspaceMessagePayload>;
}): Array<WorkspaceSendMessageResponse> {
  return data.messagePayloadsByWorkspace.map(
    (payload: WorkspaceMessagePayload): WorkspaceSendMessageResponse => {
      return {
        workspaceType: payload.workspaceType,
        threads: payload.channelIds.map((channelId: string) => {
          return {
            channel: {
              id: channelId,
              name: "inc-42",
              workspaceType: payload.workspaceType,
              ...(payload.teamId ? { teamId: payload.teamId } : {}),
            },
            threadId: `${channelId}-post`,
          };
        }),
      };
    },
  );
}

let store: InMemoryLiveMessages;
let names: Map<string, User>;
let isRuleOn: boolean;
let postSpy: SpyInstance<
  typeof WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot
>;
let slackUpdate: SpyInstance<typeof SlackUtil.updateMessage>;
let teamsUpdate: SpyInstance<typeof MicrosoftTeamsUtil.updateMessage>;
let rowRead: SpyInstance<typeof AutoRemediationSuggestionService.findOneBy>;

beforeEach(() => {
  store = new InMemoryLiveMessages();
  store.install();
  row = waitingRow();
  isRuleOn = true;
  names = new Map<string, User>([
    [ANA_ID.toString(), person("Ana Lopez")],
    [BEN_ID.toString(), person("Ben Okafor")],
  ]);

  // No Valkey here: the local hold keeps one key's edits one at a time.
  jest
    .spyOn(Semaphore, "lock")
    .mockRejectedValue(new Error("Redis client is not connected"));

  rowRead = jest
    .spyOn(AutoRemediationSuggestionService, "findOneBy")
    .mockImplementation((async (): Promise<AutoRemediationSuggestion> => {
      return suggestionOf({ ...row });
    }) as never);
  jest.spyOn(UserService, "findOneById").mockImplementation((async (args: {
    id: ObjectID;
  }): Promise<User | null> => {
    return names.get(args.id.toString()) || null;
  }) as never);
  jest
    .spyOn(ProjectService, "findOneById")
    .mockImplementation((async (): Promise<Project> => {
      const project: Project = new Project();
      project.id = PROJECT_ID;
      project.requireTwoApprovalsForRiskierFixes = isRuleOn;
      return project;
    }) as never);
  jest
    .spyOn(IncidentService, "getIncidentLinkInDashboard")
    .mockResolvedValue(URL.fromString(INCIDENT_URL));

  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockImplementation((async (data: {
      workspaceType: WorkspaceType;
    }): Promise<WorkspaceProjectAuthToken> => {
      return auth(data.workspaceType);
    }) as never);

  // Posting the proposal, wherever the incident's messages go.
  jest
    .spyOn(WorkspaceNotificationRuleService, "hasConnectedWorkspace")
    .mockResolvedValue(true);
  jest
    .spyOn(
      WorkspaceNotificationRuleService,
      "createChannelsForRulesThatNowMatch",
    )
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(WorkspaceNotificationRuleService, "getMessageDestinationsWanting")
    .mockImplementation((async (data: {
      workspaceType: WorkspaceType;
    }): Promise<Array<WorkspaceMessagePayload>> => {
      return [destinationOf(data.workspaceType)];
    }) as never);
  jest
    .spyOn(WorkspaceNotificationRuleService, "logSendResponses")
    .mockResolvedValue(undefined);
  jest
    .spyOn(WorkspaceUtil, "getMessageBlocksByMarkdown")
    .mockImplementation((async (): Promise<
      Array<MessageBlocksByWorkspaceType>
    > => {
      return [WorkspaceType.Slack, WorkspaceType.MicrosoftTeams].map(
        (workspaceType: WorkspaceType): MessageBlocksByWorkspaceType => {
          return { workspaceType, messageBlocks: [markdown(ENTRY)] };
        },
      );
    }) as never);
  postSpy = jest
    .spyOn(WorkspaceUtil, "postMessageToAllWorkspaceChannelsAsBot")
    .mockImplementation((async (data: {
      messagePayloadsByWorkspace: Array<WorkspaceMessagePayload>;
    }): Promise<Array<WorkspaceSendMessageResponse>> => {
      return postedEverywhere(data);
    }) as never);

  slackUpdate = jest
    .spyOn(SlackUtil, "updateMessage")
    .mockResolvedValue(undefined);
  teamsUpdate = jest
    .spyOn(MicrosoftTeamsUtil, "updateMessage")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The proposal's message, posted as the runners post it.
async function proposeTheFix(): Promise<void> {
  const fix: RemediationChatFix = {
    ...fixNow(),
    approvalsNeeded: 2,
  };

  await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification({
    projectId: PROJECT_ID,
    notificationFor: { incidentId: INCIDENT_ID },
    feedInfoInMarkdown: ENTRY,
    workspaceNotification: {
      sendWorkspaceNotification: true,
      ...RemediationChatMessage.withFixMessage({
        suggestionId: SUGGESTION_ID,
        appendMessageBlocks:
          await RemediationChatMessage.getApprovalBlocks(fix),
      }),
    },
  });

  postSpy.mockClear();
}

// What the fix's own blocks say now, in one chat.
async function fixBlocks(
  workspaceType: WorkspaceType,
  state: RemediationFixMessageState,
): Promise<Array<WorkspaceMessageBlock>> {
  const blocks: Array<MessageBlocksByWorkspaceType> =
    await RemediationChatMessage.getApprovalBlocks(
      { ...fixNow(), approvalsNeeded: 2 },
      state,
    );

  return blocks.find((each: MessageBlocksByWorkspaceType): boolean => {
    return each.workspaceType === workspaceType;
  })!.messageBlocks;
}

function lastEditOf(
  spy:
    | SpyInstance<typeof SlackUtil.updateMessage>
    | SpyInstance<typeof MicrosoftTeamsUtil.updateMessage>,
): {
  messageBlocks: Array<WorkspaceMessageBlock>;
  text?: string | undefined;
} {
  const calls: Array<Array<unknown>> = spy.mock.calls as Array<Array<unknown>>;

  return calls[calls.length - 1]![0] as {
    messageBlocks: Array<WorkspaceMessageBlock>;
    text?: string | undefined;
  };
}

function noteOf(blocks: Array<WorkspaceMessageBlock>): string {
  const note: WorkspacePayloadContext | undefined = blocks.find(
    (block: WorkspaceMessageBlock): boolean => {
      return block._type === "WorkspacePayloadContext";
    },
  ) as WorkspacePayloadContext | undefined;

  return note?.text || "";
}

function buttonsOf(
  blocks: Array<WorkspaceMessageBlock>,
): Array<WorkspaceMessagePayloadButton> {
  return blocks
    .filter((block: WorkspaceMessageBlock): boolean => {
      return block._type === "WorkspacePayloadButtons";
    })
    .flatMap(
      (block: WorkspaceMessageBlock): Array<WorkspaceMessagePayloadButton> => {
        return (block as WorkspacePayloadButtons).buttons;
      },
    );
}

function actionsOf(blocks: Array<WorkspaceMessageBlock>): Array<string> {
  return buttonsOf(blocks).map(
    (button: WorkspaceMessagePayloadButton): string => {
      return button.actionId || "";
    },
  );
}

describe("the proposal's posts are kept where they went", () => {
  test("each post is kept under the fix's key, with the entry's own blocks", async () => {
    await proposeTheFix();

    const kept: Array<WorkspaceLiveMessage> = store.forKey(KEY);
    expect(kept).toHaveLength(2);

    const slack: WorkspaceLiveMessage = kept.find(
      (each: WorkspaceLiveMessage): boolean => {
        return each.workspaceType === WorkspaceType.Slack;
      },
    )!;
    const teams: WorkspaceLiveMessage = kept.find(
      (each: WorkspaceLiveMessage): boolean => {
        return each.workspaceType === WorkspaceType.MicrosoftTeams;
      },
    )!;

    expect(slack.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(slack.channelId).toBe(SLACK_CHANNEL);
    expect(slack.messageId).toBe(`${SLACK_CHANNEL}-post`);
    expect(slack.destinationType).toBe(
      WorkspaceLiveMessageDestinationType.Channel,
    );
    expect(teams.channelId).toBe(TEAMS_CHANNEL);
    expect(teams.teamId).toBe(TEAMS_TEAM);
    expect(teams.messageId).toBe(`${TEAMS_CHANNEL}-post`);

    // Only the entry's own blocks: an edit rewrites what follows them.
    expect(slack.messageData?.leadBlocks).toEqual([markdown(ENTRY)]);
    expect(teams.messageData?.leadBlocks).toEqual([markdown(ENTRY)]);

    // What it says, as posted: the entry, then the fix's blocks.
    expect(slack.contentHash).toBe(
      WorkspaceLiveMessages.getContentHash([
        markdown(ENTRY),
        ...(await fixBlocks(WorkspaceType.Slack, { kind: "waiting" })),
      ]),
    );
  });

  test("a feed entry that keeps nothing - every other one - leaves no row", async () => {
    await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification({
      projectId: PROJECT_ID,
      notificationFor: { incidentId: INCIDENT_ID },
      feedInfoInMarkdown: ENTRY,
      workspaceNotification: {
        sendWorkspaceNotification: true,
        appendMessageBlocks:
          await RemediationChatMessage.getApprovalBlocks(fixNow()),
      },
    });

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(store.rows).toHaveLength(0);
  });

  test("a post OneUptime could not remember is still posted, and the send does not fail", async () => {
    jest
      .spyOn(WorkspaceLiveMessageService, "create")
      .mockRejectedValue(new Error("database is down"));

    await expect(proposeTheFix()).resolves.toBeUndefined();
    expect(store.rows).toHaveLength(0);
  });

  test("the feed carries the key through to the send, and only when given", () => {
    const given: ReturnType<
      typeof FeedWorkspaceNotificationUtil.toWorkspaceNotification
    > = FeedWorkspaceNotificationUtil.toWorkspaceNotification({
      workspaceNotification: {
        sendWorkspaceNotification: true,
        keepPostsAs: KEY,
      },
    });
    expect(given.keepPostsAs).toBe(KEY);

    const notGiven: ReturnType<
      typeof FeedWorkspaceNotificationUtil.toWorkspaceNotification
    > = FeedWorkspaceNotificationUtil.toWorkspaceNotification({
      workspaceNotification: { sendWorkspaceNotification: true },
    });
    expect("keepPostsAs" in notGiven).toBe(false);
  });
});

describe("WorkspaceLiveMessages.keepPosts", () => {
  const lead: Map<WorkspaceType, Array<WorkspaceMessageBlock>> = new Map<
    WorkspaceType,
    Array<WorkspaceMessageBlock>
  >([
    [WorkspaceType.Slack, [markdown("entry")]],
    [WorkspaceType.MicrosoftTeams, [markdown("entry")]],
  ]);

  function payload(
    data: Partial<WorkspaceMessagePayload>,
  ): WorkspaceMessagePayload {
    return {
      _type: "WorkspaceMessagePayload",
      workspaceType: WorkspaceType.Slack,
      messageBlocks: [markdown("entry"), markdown("fix")],
      channelNames: [],
      channelIds: [],
      ...data,
    };
  }

  test("a channel post and a chat post: each kept as what it is", async () => {
    const teams: WorkspaceMessagePayload = payload({
      workspaceType: WorkspaceType.MicrosoftTeams,
      channelIds: [TEAMS_CHANNEL],
      chatIds: ["19:chat-ana-ben@thread.v2"],
      teamId: TEAMS_TEAM,
    });

    const kept: Array<WorkspaceLiveMessage> =
      await WorkspaceLiveMessages.keepPosts({
        projectId: PROJECT_ID,
        messageKey: KEY,
        payloads: [teams],
        responses: [
          {
            workspaceType: WorkspaceType.MicrosoftTeams,
            threads: [
              {
                channel: {
                  id: TEAMS_CHANNEL,
                  name: "inc-42",
                  workspaceType: WorkspaceType.MicrosoftTeams,
                },
                threadId: "channel-post",
              },
              {
                channel: {
                  id: "19:chat-ana-ben@thread.v2",
                  name: "Ana, Ben",
                  workspaceType: WorkspaceType.MicrosoftTeams,
                },
                threadId: "chat-post",
              },
            ],
          },
        ],
        leadBlocksByWorkspaceType: lead,
      });

    expect(kept).toHaveLength(2);
    expect(
      store.rows.map((each: WorkspaceLiveMessage) => {
        return [
          each.channelId,
          each.destinationType,
          each.teamId,
          each.messageId,
        ];
      }),
    ).toEqual([
      [
        TEAMS_CHANNEL,
        WorkspaceLiveMessageDestinationType.Channel,
        TEAMS_TEAM,
        "channel-post",
      ],
      [
        "19:chat-ana-ben@thread.v2",
        WorkspaceLiveMessageDestinationType.Chat,
        TEAMS_TEAM,
        "chat-post",
      ],
    ]);
  });

  test("nothing is kept for a post that failed, has no id, or no place", async () => {
    const kept: Array<WorkspaceLiveMessage> =
      await WorkspaceLiveMessages.keepPosts({
        projectId: PROJECT_ID,
        messageKey: KEY,
        payloads: [
          payload({ channelIds: ["C-not-sent"] }),
          payload({ channelIds: ["C-no-id"] }),
          payload({ channelIds: ["C-no-place"] }),
        ],
        responses: [
          {
            workspaceType: WorkspaceType.Slack,
            threads: [],
            errors: [
              {
                channel: {
                  id: "C-not-sent",
                  name: "inc-42",
                  workspaceType: WorkspaceType.Slack,
                },
                error: "not_in_channel",
              },
            ],
          },
          {
            workspaceType: WorkspaceType.Slack,
            threads: [
              {
                channel: {
                  id: "C-no-id",
                  name: "inc-42",
                  workspaceType: WorkspaceType.Slack,
                },
                threadId: "",
              },
            ],
          },
          {
            workspaceType: WorkspaceType.Slack,
            threads: [
              {
                channel: {
                  id: "",
                  name: "",
                  workspaceType: WorkspaceType.Slack,
                },
                threadId: "1700000000.000100",
              },
            ],
          },
        ],
        leadBlocksByWorkspaceType: lead,
      });

    expect(kept).toHaveLength(0);
    expect(store.rows).toHaveLength(0);
  });

  test("an answer for another workspace is never taken for this payload's post", async () => {
    const kept: Array<WorkspaceLiveMessage> =
      await WorkspaceLiveMessages.keepPosts({
        projectId: PROJECT_ID,
        messageKey: KEY,
        payloads: [payload({ channelIds: [SLACK_CHANNEL] })],
        responses: [
          {
            workspaceType: WorkspaceType.MicrosoftTeams,
            threads: [
              {
                channel: {
                  id: TEAMS_CHANNEL,
                  name: "inc-42",
                  workspaceType: WorkspaceType.MicrosoftTeams,
                },
                threadId: "teams-post",
              },
            ],
          },
        ],
        leadBlocksByWorkspaceType: lead,
      });

    expect(kept).toHaveLength(0);
  });

  test("a message that went out as several posts is not kept: an edit would garble its last", async () => {
    const blocks: Array<WorkspaceMessageBlock> = Array.from(
      { length: WorkspaceLiveMessages.MAX_BLOCKS_IN_ONE_POST + 1 },
      (_: unknown, index: number): WorkspaceMessageBlock => {
        return markdown(`block ${index}`);
      },
    );

    const kept: Array<WorkspaceLiveMessage> =
      await WorkspaceLiveMessages.keepPosts({
        projectId: PROJECT_ID,
        messageKey: KEY,
        payloads: [
          payload({ channelIds: [SLACK_CHANNEL], messageBlocks: blocks }),
        ],
        responses: [
          {
            workspaceType: WorkspaceType.Slack,
            threads: [
              {
                channel: {
                  id: SLACK_CHANNEL,
                  name: "inc-42",
                  workspaceType: WorkspaceType.Slack,
                },
                threadId: "last-of-two-posts",
              },
            ],
          },
        ],
        leadBlocksByWorkspaceType: lead,
      });

    expect(kept).toHaveLength(0);

    // One block fewer goes out as one post, and is kept.
    await WorkspaceLiveMessages.keepPosts({
      projectId: PROJECT_ID,
      messageKey: KEY,
      payloads: [
        payload({
          channelIds: [SLACK_CHANNEL],
          messageBlocks: blocks.slice(1),
        }),
      ],
      responses: [
        {
          workspaceType: WorkspaceType.Slack,
          threads: [
            {
              channel: {
                id: SLACK_CHANNEL,
                name: "inc-42",
                workspaceType: WorkspaceType.Slack,
              },
              threadId: "one-post",
            },
          ],
        },
      ],
      leadBlocksByWorkspaceType: lead,
    });

    expect(store.rows).toHaveLength(1);
  });

  test("one post that cannot be remembered does not stop the next", async () => {
    const create: SpyInstance<typeof WorkspaceLiveMessageService.create> =
      jest.spyOn(WorkspaceLiveMessageService, "create");
    create.mockRejectedValueOnce(new Error("database blinked"));

    const kept: Array<WorkspaceLiveMessage> =
      await WorkspaceLiveMessages.keepPosts({
        projectId: PROJECT_ID,
        messageKey: KEY,
        payloads: [payload({ channelIds: ["C-one", "C-two"] })],
        responses: [
          {
            workspaceType: WorkspaceType.Slack,
            threads: ["C-one", "C-two"].map((id: string) => {
              return {
                channel: {
                  id,
                  name: id,
                  workspaceType: WorkspaceType.Slack,
                },
                threadId: `${id}-post`,
              };
            }),
          },
        ],
        leadBlocksByWorkspaceType: lead,
      });

    expect(kept).toHaveLength(1);
    expect(
      store.rows.map((each: WorkspaceLiveMessage) => {
        return each.channelId;
      }),
    ).toEqual(["C-two"]);
  });
});

describe("RemediationChatMessage.withFixMessage", () => {
  test("the fix's blocks, and the key its posts are kept under", async () => {
    const blocks: Array<MessageBlocksByWorkspaceType> =
      await RemediationChatMessage.getApprovalBlocks(fixNow());

    expect(
      RemediationChatMessage.withFixMessage({
        suggestionId: SUGGESTION_ID,
        appendMessageBlocks: blocks,
      }),
    ).toEqual({ appendMessageBlocks: blocks, keepPostsAs: KEY });
  });

  test("no blocks, nothing to post or keep; no fix id, posted but not kept", async () => {
    expect(
      RemediationChatMessage.withFixMessage({
        suggestionId: SUGGESTION_ID,
        appendMessageBlocks: [],
      }),
    ).toEqual({});
    expect(
      RemediationChatMessage.withFixMessage({ suggestionId: SUGGESTION_ID }),
    ).toEqual({});

    const blocks: Array<MessageBlocksByWorkspaceType> =
      await RemediationChatMessage.getApprovalBlocks(fixNow());
    expect(
      RemediationChatMessage.withFixMessage({
        suggestionId: null,
        appendMessageBlocks: blocks,
      }),
    ).toEqual({ appendMessageBlocks: blocks });
  });

  test("each fix has its own key", () => {
    const other: ObjectID = ObjectID.generate();

    expect(RemediationChatMessage.getLiveMessageKey(SUGGESTION_ID)).toBe(KEY);
    expect(RemediationChatMessage.getLiveMessageKey(other)).not.toBe(KEY);
    expect(KEY).toBe(`RemediationFix:${SUGGESTION_ID.toString()}`);
  });
});

describe("how the fix's message reads, as the fix stands", () => {
  test("waiting: Review and approve, Dismiss and View, and that two people must approve", async () => {
    const blocks: Array<WorkspaceMessageBlock> = await fixBlocks(
      WorkspaceType.Slack,
      { kind: "waiting" },
    );

    expect(actionsOf(blocks)).toEqual([
      SlackActionType.ViewApproveRemediation,
      SlackActionType.DismissRemediation,
      SlackActionType.OpenInOneUptime,
    ]);
    expect(noteOf(blocks)).toBe(TWO_APPROVALS_MESSAGE_NOTE);
  });

  test("after the first of two approvals: the same buttons, for the same fix, and whose approval is in", async () => {
    const waiting: Array<WorkspaceMessageBlock> = await fixBlocks(
      WorkspaceType.Slack,
      { kind: "waiting" },
    );
    const blocks: Array<WorkspaceMessageBlock> = await fixBlocks(
      WorkspaceType.Slack,
      { kind: "firstApproved", firstApproverName: "Ana Lopez" },
    );

    // A second approver presses what the first did: the same fix, the same plan.
    expect(buttonsOf(blocks)).toEqual(buttonsOf(waiting));
    expect(buttonsOf(blocks)[0]!.value).toBe(
      `${SUGGESTION_ID.toString()}:${planFingerprint()}`,
    );
    expect(noteOf(blocks)).toBe(
      "**Ana Lopez** approved this fix first. It runs once someone else approves it too. Review and approve shows the whole fix before you do.",
    );
    // Never read as if one press from anyone runs it.
    expect(noteOf(blocks)).not.toContain("Nothing runs until you approve it");

    expect(
      noteOf(await fixBlocks(WorkspaceType.Slack, { kind: "firstApproved" })),
    ).toBe(
      "Someone approved this fix first. It runs once someone else approves it too. Review and approve shows the whole fix before you do.",
    );
  });

  test("approved: only View in OneUptime is left, and who approved it - after whose first", async () => {
    const blocks: Array<WorkspaceMessageBlock> = await fixBlocks(
      WorkspaceType.Slack,
      {
        kind: "approved",
        approverName: "Ben Okafor",
        firstApproverName: "Ana Lopez",
      },
    );

    expect(actionsOf(blocks)).toEqual([SlackActionType.OpenInOneUptime]);
    expect(buttonsOf(blocks)[0]!.title).toBe(getViewInProductTitle());
    expect(buttonsOf(blocks)[0]!.url?.toString()).toBe(INCIDENT_URL);
    expect(noteOf(blocks)).toBe(
      "✅ **Ben Okafor** approved this fix, after **Ana Lopez** approved it first.",
    );

    expect(
      noteOf(
        await fixBlocks(WorkspaceType.Slack, {
          kind: "approved",
          approverName: "Ben Okafor",
        }),
      ),
    ).toBe("✅ **Ben Okafor** approved this fix.");
    expect(
      noteOf(await fixBlocks(WorkspaceType.Slack, { kind: "approved" })),
    ).toBe("✅ This fix was approved.");
  });

  test("dismissed: only View in OneUptime is left, and who dismissed it", async () => {
    const blocks: Array<WorkspaceMessageBlock> = await fixBlocks(
      WorkspaceType.MicrosoftTeams,
      { kind: "dismissed", dismisserName: "Ben Okafor" },
    );

    expect(actionsOf(blocks)).toEqual([SlackActionType.OpenInOneUptime]);
    expect(noteOf(blocks)).toBe("**Ben Okafor** dismissed this fix.");
    expect(
      noteOf(
        await fixBlocks(WorkspaceType.MicrosoftTeams, { kind: "dismissed" }),
      ),
    ).toBe("This fix was dismissed.");
  });

  test("approved with no page to link to: no buttons block at all, the changes and the line stay", async () => {
    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockRejectedValue(new Error("no dashboard url"));

    const blocks: Array<WorkspaceMessageBlock> = await fixBlocks(
      WorkspaceType.Slack,
      { kind: "approved", approverName: "Ben Okafor" },
    );

    expect(
      blocks.map((block: WorkspaceMessageBlock): string => {
        return block._type;
      }),
    ).toEqual(["WorkspacePayloadMarkdown", "WorkspacePayloadContext"]);
  });

  test("a name is text, never markdown, and a long one is cut", () => {
    const note: string = RemediationChatMessage.describeMessageNote({
      approvalsNeeded: 2,
      state: {
        kind: "firstApproved",
        firstApproverName: "[Eve](https://evil.example) *now*",
      },
    }).toString();

    // No link and no emphasis of its own: each mark is escaped.
    expect(note).not.toContain("[Eve](");
    expect(note).not.toMatch(/(^|[^\\])\*now/);
    expect(note).toContain("\\[Eve\\]");
    expect(note.replace(/\\/g, "")).toContain(
      "**[Eve](https://evil.example) *now*** approved this fix first.",
    );

    const long: string = RemediationChatMessage.describeMessageNote({
      approvalsNeeded: 2,
      state: { kind: "approved", approverName: "A".repeat(500) },
    }).toString();

    expect(long).toContain(`**${"A".repeat(119)}…**`);
    expect(long).not.toContain("A".repeat(120));
  });

  test("the Reviewing dialog's button words are what the message shows", async () => {
    const blocks: Array<WorkspaceMessageBlock> = await fixBlocks(
      WorkspaceType.Slack,
      { kind: "firstApproved", firstApproverName: "Ana Lopez" },
    );

    expect(
      buttonsOf(blocks).map((button: WorkspaceMessagePayloadButton) => {
        return button.title;
      }),
    ).toEqual([
      REMEDIATION_CHAT_WORDS.reviewAndApprove,
      REMEDIATION_CHAT_WORDS.dismiss,
      getViewInProductTitle(),
    ]);
  });
});

describe("RemediationChatMessage.getMessageState: read from the fix's row", () => {
  test("waiting, with no first approval", async () => {
    await expect(
      RemediationChatMessage.getMessageState(suggestionOf(row)),
    ).resolves.toEqual({ kind: "waiting" });
  });

  test("a first approval for this plan names who gave it", async () => {
    firstApprovedBy(ANA_ID);

    await expect(
      RemediationChatMessage.getMessageState(suggestionOf(row)),
    ).resolves.toEqual({
      kind: "firstApproved",
      firstApproverName: "Ana Lopez",
    });
  });

  test("a first approval given to another plan counts for nothing: the fix waits", async () => {
    firstApprovedBy(ANA_ID);
    row["firstApprovedPlanFingerprint"] = "0123456789abcdef";

    await expect(
      RemediationChatMessage.getMessageState(suggestionOf(row)),
    ).resolves.toEqual({ kind: "waiting" });

    // Nor does one recorded before approvals were bound to their plan.
    row["firstApprovedPlanFingerprint"] = undefined;

    await expect(
      RemediationChatMessage.getMessageState(suggestionOf(row)),
    ).resolves.toEqual({ kind: "waiting" });
  });

  test("approved: who approved it, and whose came first", async () => {
    firstApprovedBy(ANA_ID);
    approvedBy(BEN_ID);

    await expect(
      RemediationChatMessage.getMessageState(suggestionOf(row)),
    ).resolves.toEqual({
      kind: "approved",
      approverName: "Ben Okafor",
      firstApproverName: "Ana Lopez",
    });
  });

  test("approved on one approval: who approved it, and nobody first", async () => {
    approvedBy(BEN_ID);

    await expect(
      RemediationChatMessage.getMessageState(suggestionOf(row)),
    ).resolves.toEqual({
      kind: "approved",
      approverName: "Ben Okafor",
      firstApproverName: undefined,
    });

    // A row naming one person twice never says they approved it after themselves.
    firstApprovedBy(BEN_ID);

    await expect(
      RemediationChatMessage.getMessageState(suggestionOf(row)),
    ).resolves.toMatchObject({ firstApproverName: undefined });
  });

  test("dismissed: who dismissed it; a name that cannot be read is left out", async () => {
    dismissedBy(BEN_ID);

    await expect(
      RemediationChatMessage.getMessageState(suggestionOf(row)),
    ).resolves.toEqual({ kind: "dismissed", dismisserName: "Ben Okafor" });

    names.clear();

    await expect(
      RemediationChatMessage.getMessageState(suggestionOf(row)),
    ).resolves.toEqual({ kind: "dismissed", dismisserName: undefined });
  });

  // The fix's channels are not all the project's people to read (#10669).
  test("a person with no name is named by the part of their address before the @, never the address", async () => {
    names.set(BEN_ID.toString(), person("", "ben@example.com"));
    dismissedBy(BEN_ID);

    await expect(
      RemediationChatMessage.getMessageState(suggestionOf(row)),
    ).resolves.toEqual({ kind: "dismissed", dismisserName: "ben" });
  });

  test.each([
    AutoRemediationSuggestionStatus.Planning,
    AutoRemediationSuggestionStatus.AutoExecuted,
    AutoRemediationSuggestionStatus.NoneApplicable,
  ])(
    "%s: nothing new to say",
    async (status: AutoRemediationSuggestionStatus) => {
      row["status"] = status;

      await expect(
        RemediationChatMessage.getMessageState(suggestionOf(row)),
      ).resolves.toBeNull();
    },
  );
});

describe("RemediationChatMessage.refreshKeptMessages: each kept post, edited where it is", () => {
  test("after the first approval: both posts say whose it is, keep their buttons, and nothing is posted anew", async () => {
    await proposeTheFix();
    firstApprovedBy(ANA_ID);

    await RemediationChatMessage.refreshKeptMessages({
      suggestionId: SUGGESTION_ID,
      projectId: PROJECT_ID,
    });

    expect(slackUpdate).toHaveBeenCalledTimes(1);
    expect(teamsUpdate).toHaveBeenCalledTimes(1);
    expect(postSpy).not.toHaveBeenCalled();

    const slackBlocks: Array<WorkspaceMessageBlock> = [
      markdown(ENTRY),
      ...(await fixBlocks(WorkspaceType.Slack, {
        kind: "firstApproved",
        firstApproverName: "Ana Lopez",
      })),
    ];

    expect(slackUpdate.mock.calls[0]![0]).toEqual({
      authToken: "Slack-token",
      projectId: PROJECT_ID,
      location: { channelId: SLACK_CHANNEL, teamId: undefined, isChat: false },
      messageId: `${SLACK_CHANNEL}-post`,
      messageBlocks: slackBlocks,
      text: WorkspaceNotificationText.fromBlocks(slackBlocks),
    });
    expect(teamsUpdate.mock.calls[0]![0]).toMatchObject({
      location: {
        channelId: TEAMS_CHANNEL,
        teamId: TEAMS_TEAM,
        isChat: false,
      },
      messageId: `${TEAMS_CHANNEL}-post`,
      messageBlocks: [
        markdown(ENTRY),
        ...(await fixBlocks(WorkspaceType.MicrosoftTeams, {
          kind: "firstApproved",
          firstApproverName: "Ana Lopez",
        })),
      ],
    });

    // The entry stays on top; the note under the buttons names Ana.
    expect(lastEditOf(slackUpdate).messageBlocks[0]).toEqual(markdown(ENTRY));
    expect(noteOf(lastEditOf(teamsUpdate).messageBlocks)).toContain(
      "**Ana Lopez** approved this fix first.",
    );
    expect(actionsOf(lastEditOf(slackUpdate).messageBlocks)).toEqual([
      SlackActionType.ViewApproveRemediation,
      SlackActionType.DismissRemediation,
      SlackActionType.OpenInOneUptime,
    ]);

    // Remembered as it reads now: the same state again sends nothing.
    await RemediationChatMessage.refreshKeptMessages({
      suggestionId: SUGGESTION_ID,
      projectId: PROJECT_ID,
    });
    expect(slackUpdate).toHaveBeenCalledTimes(1);
    expect(teamsUpdate).toHaveBeenCalledTimes(1);
  });

  test("after the second approval: the buttons that would do nothing now are gone, and both names are said", async () => {
    await proposeTheFix();
    firstApprovedBy(ANA_ID);
    await RemediationChatMessage.refreshKeptMessages({
      suggestionId: SUGGESTION_ID,
      projectId: PROJECT_ID,
    });
    approvedBy(BEN_ID);

    await RemediationChatMessage.refreshKeptMessages({
      suggestionId: SUGGESTION_ID,
      projectId: PROJECT_ID,
    });

    expect(slackUpdate).toHaveBeenCalledTimes(2);
    expect(teamsUpdate).toHaveBeenCalledTimes(2);

    for (const edit of [lastEditOf(slackUpdate), lastEditOf(teamsUpdate)]) {
      expect(edit.messageBlocks[0]).toEqual(markdown(ENTRY));
      expect(actionsOf(edit.messageBlocks)).toEqual([
        SlackActionType.OpenInOneUptime,
      ]);
      expect(noteOf(edit.messageBlocks)).toBe(
        "✅ **Ben Okafor** approved this fix, after **Ana Lopez** approved it first.",
      );
    }
  });

  test("after a dismissal: no Approve is left, and who dismissed it is said", async () => {
    await proposeTheFix();
    dismissedBy(BEN_ID);

    await RemediationChatMessage.refreshKeptMessages({
      suggestionId: SUGGESTION_ID,
      projectId: PROJECT_ID,
    });

    expect(actionsOf(lastEditOf(slackUpdate).messageBlocks)).toEqual([
      SlackActionType.OpenInOneUptime,
    ]);
    expect(noteOf(lastEditOf(slackUpdate).messageBlocks)).toBe(
      "**Ben Okafor** dismissed this fix.",
    );
  });

  test("a fix with no kept posts: nothing is read past that, nothing edited", async () => {
    firstApprovedBy(ANA_ID);

    await RemediationChatMessage.refreshKeptMessages({
      suggestionId: SUGGESTION_ID,
      projectId: PROJECT_ID,
    });

    expect(rowRead).not.toHaveBeenCalled();
    expect(slackUpdate).not.toHaveBeenCalled();
    expect(teamsUpdate).not.toHaveBeenCalled();
  });

  test("another fix's posts are never edited", async () => {
    await proposeTheFix();
    firstApprovedBy(ANA_ID);

    await RemediationChatMessage.refreshKeptMessages({
      suggestionId: ObjectID.generate(),
      projectId: PROJECT_ID,
    });

    expect(slackUpdate).not.toHaveBeenCalled();
    expect(teamsUpdate).not.toHaveBeenCalled();
  });

  test("the fix is read in its own project only", async () => {
    await proposeTheFix();
    firstApprovedBy(ANA_ID);

    await RemediationChatMessage.refreshKeptMessages({
      suggestionId: SUGGESTION_ID,
      projectId: PROJECT_ID,
    });

    expect(rowRead).toHaveBeenCalledTimes(1);
    expect(
      (rowRead.mock.calls[0]![0] as { query: Record<string, unknown> }).query,
    ).toEqual({ _id: SUGGESTION_ID, projectId: PROJECT_ID });
  });

  test("a fix that is gone, or still being planned, leaves its posts as they are", async () => {
    await proposeTheFix();
    rowRead.mockResolvedValueOnce(null);

    await RemediationChatMessage.refreshKeptMessages({
      suggestionId: SUGGESTION_ID,
      projectId: PROJECT_ID,
    });

    row["status"] = AutoRemediationSuggestionStatus.Planning;

    await RemediationChatMessage.refreshKeptMessages({
      suggestionId: SUGGESTION_ID,
      projectId: PROJECT_ID,
    });

    expect(slackUpdate).not.toHaveBeenCalled();
    expect(teamsUpdate).not.toHaveBeenCalled();
  });

  test("a fix that waits again (its first approval was for another plan) says what one press does now", async () => {
    await proposeTheFix();
    firstApprovedBy(ANA_ID);
    await RemediationChatMessage.refreshKeptMessages({
      suggestionId: SUGGESTION_ID,
      projectId: PROJECT_ID,
    });
    row["firstApprovedPlanFingerprint"] = "0123456789abcdef";

    await RemediationChatMessage.refreshKeptMessages({
      suggestionId: SUGGESTION_ID,
      projectId: PROJECT_ID,
    });

    expect(noteOf(lastEditOf(slackUpdate).messageBlocks)).toBe(
      TWO_APPROVALS_MESSAGE_NOTE,
    );

    // And with the rule turned off since, that one approval runs it.
    isRuleOn = false;
    firstApprovedBy(ANA_ID);
    await RemediationChatMessage.refreshKeptMessages({
      suggestionId: SUGGESTION_ID,
      projectId: PROJECT_ID,
    });
    row["firstApprovedPlanFingerprint"] = "0123456789abcdef";
    await RemediationChatMessage.refreshKeptMessages({
      suggestionId: SUGGESTION_ID,
      projectId: PROJECT_ID,
    });

    expect(noteOf(lastEditOf(slackUpdate).messageBlocks)).toBe(
      "Review and approve shows the whole fix first. Nothing runs until you approve it.",
    );
  });

  test("a chat refusing one edit never stops the others, nor throws", async () => {
    await proposeTheFix();
    firstApprovedBy(ANA_ID);
    slackUpdate.mockRejectedValueOnce(new Error("ratelimited"));

    await expect(
      RemediationChatMessage.refreshKeptMessages({
        suggestionId: SUGGESTION_ID,
        projectId: PROJECT_ID,
      }),
    ).resolves.toBeUndefined();

    expect(teamsUpdate).toHaveBeenCalledTimes(1);

    // Not remembered as edited: the next change tries Slack again.
    approvedBy(BEN_ID);
    await RemediationChatMessage.refreshKeptMessages({
      suggestionId: SUGGESTION_ID,
      projectId: PROJECT_ID,
    });
    expect(slackUpdate).toHaveBeenCalledTimes(2);
  });

  test("nothing it reads failing makes it throw", async () => {
    await proposeTheFix();
    rowRead.mockRejectedValueOnce(new Error("database is down"));

    await expect(
      RemediationChatMessage.refreshKeptMessages({
        suggestionId: SUGGESTION_ID,
        projectId: PROJECT_ID,
      }),
    ).resolves.toBeUndefined();

    jest
      .spyOn(WorkspaceLiveMessageService, "findByMessageKey")
      .mockRejectedValueOnce(new Error("database is down"));

    await expect(
      RemediationChatMessage.refreshKeptMessages({
        suggestionId: SUGGESTION_ID,
        projectId: PROJECT_ID,
      }),
    ).resolves.toBeUndefined();
    expect(slackUpdate).not.toHaveBeenCalled();
  });

  test("two edits racing - the first approval's, then the second's - end on the newer", async () => {
    await proposeTheFix();
    firstApprovedBy(ANA_ID);

    // The first edit's read of Ana's name is slow...
    let releaseAna: () => void = (): void => {};
    const anaIsSlow: Promise<void> = new Promise<void>(
      (resolve: () => void) => {
        releaseAna = resolve;
      },
    );
    let isFirstNameRead: boolean = true;

    jest.spyOn(UserService, "findOneById").mockImplementation((async (args: {
      id: ObjectID;
    }): Promise<User | null> => {
      if (isFirstNameRead && args.id.toString() === ANA_ID.toString()) {
        isFirstNameRead = false;
        await anaIsSlow;
      }

      return names.get(args.id.toString()) || null;
    }) as never);

    const firstEdit: Promise<void> = RemediationChatMessage.refreshKeptMessages(
      { suggestionId: SUGGESTION_ID, projectId: PROJECT_ID },
    );

    // ...and Ben's approval lands, and its edit starts, while it waits.
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 10);
    });
    approvedBy(BEN_ID);

    const secondEdit: Promise<void> =
      RemediationChatMessage.refreshKeptMessages({
        suggestionId: SUGGESTION_ID,
        projectId: PROJECT_ID,
      });

    // Time enough for the second edit to land first, were it not held.
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 30);
    });
    releaseAna();
    await Promise.all([firstEdit, secondEdit]);

    // Whatever came first, the posts say the fix was approved.
    expect(noteOf(lastEditOf(slackUpdate).messageBlocks)).toBe(
      "✅ **Ben Okafor** approved this fix, after **Ana Lopez** approved it first.",
    );
    expect(noteOf(lastEditOf(teamsUpdate).messageBlocks)).toBe(
      "✅ **Ben Okafor** approved this fix, after **Ana Lopez** approved it first.",
    );
    expect(actionsOf(lastEditOf(slackUpdate).messageBlocks)).toEqual([
      SlackActionType.OpenInOneUptime,
    ]);
  });
});
