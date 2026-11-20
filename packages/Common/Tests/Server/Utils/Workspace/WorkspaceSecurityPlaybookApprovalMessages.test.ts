import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import WorkspaceLiveMessageService from "../../../../Server/Services/WorkspaceLiveMessageService";
import WorkspaceNotificationRuleService from "../../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import SecurityPlaybookApprovalReader, {
  SecurityPlaybookApprovalRead,
  SecurityPlaybookApprovalRound,
} from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookApprovalReader";
import WorkspaceLiveMessages from "../../../../Server/Utils/Workspace/LiveMessages/WorkspaceLiveMessages";
import WorkspaceUtil from "../../../../Server/Utils/Workspace/Workspace";
import { WorkspaceSendMessageResponse } from "../../../../Server/Utils/Workspace/WorkspaceBase";
import WorkspaceSecurityPlaybookApproval from "../../../../Server/Utils/Workspace/WorkspaceSecurityPlaybookApproval";
import WorkspaceSecurityPlaybookApprovalMessages from "../../../../Server/Utils/Workspace/WorkspaceSecurityPlaybookApprovalMessages";
import SecurityPlaybookRun from "../../../../Models/DatabaseModels/SecurityPlaybookRun";
import WorkspaceLiveMessage from "../../../../Models/DatabaseModels/WorkspaceLiveMessage";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import BadRequestException from "../../../../Types/Exception/BadRequestException";
import ObjectID from "../../../../Types/ObjectID";
import { SecurityPlaybookActionType } from "../../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import SecurityPlaybookRunStatus, {
  SecurityPlaybookStepStatus,
} from "../../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import { SecurityPlaybookStep } from "../../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  SecurityPlaybookApprovalDecision,
  SecurityPlaybookStepResult,
  SecurityPlaybookTargetReason,
  SecurityPlaybookTargetState,
} from "../../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import SecurityPlaybookTrigger from "../../../../Types/SecurityPlaybook/SecurityPlaybookTrigger";
import { NotificationRuleUpdateKind } from "../../../../Types/Workspace/NotificationRules/NotificationRuleUpdates";
import { WorkspaceLiveMessageDestinationType } from "../../../../Types/Workspace/WorkspaceLiveMessageKey";
import WorkspaceMessagePayload, {
  WorkspaceMessageBlock,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import {
  SecurityPlaybookApprovalAsk,
  SecurityPlaybookApprovalEvidenceKind,
  SecurityPlaybookApprovalSourceKind,
  SecurityPlaybookApprovalStandingKind,
} from "../../../../Utils/SecurityPlaybook/SecurityPlaybookApprovalWords";
import InMemoryLiveMessages from "./LiveMessages/InMemoryLiveMessages";

jest.mock("../../../../Server/Utils/Logger");

/*
 * EVERY COPY OF A PLAYBOOK STEP'S APPROVAL MESSAGE (#10341): POSTED WHERE THE
 * CASE'S RULES NAME FOR APPROVALS, KEPT AS EACH APPROVER'S DIRECT MESSAGE
 * LANDS, AND DRAWN AGAIN - EACH IN ITS OWN LANGUAGE, THROUGH ITS OWN
 * WORKSPACE - WHEN THE APPROVAL MOVES ON.
 *
 * The rows are an in-memory WorkspaceLiveMessage table; Slack's and the Bot
 * Framework's APIs, the rules and the run are stood in for.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "c9000000-0000-4000-8000-000000000001",
);
const JANE: ObjectID = new ObjectID("c9000000-0000-4000-8000-0000000000a1");
const RUN_ID: ObjectID = new ObjectID("c9000000-0000-4000-8000-0000000000c1");
const TENANT_ID: string = "5151aaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const ROUND: SecurityPlaybookApprovalRound = {
  projectId: PROJECT_ID,
  runId: RUN_ID,
  securityCaseId: new ObjectID("c9000000-0000-4000-8000-0000000000b1"),
  stepIndex: 1,
  stepId: "contain",
  targetsDigest: "abcdefghijklmnopqrstuv",
};

const KEY: string = `SecurityPlaybookApproval:${RUN_ID.toString()}:1`;

const STEP: SecurityPlaybookStep = {
  id: "contain",
  action: SecurityPlaybookActionType.SuspendOktaUser,
  config: { connectionId: "c9000000-0000-4000-8000-0000000000d1" },
  requiresApproval: true,
  continueOnFailure: false,
  onlyIfThreatIntelMatched: false,
};

function askOf(
  overrides: Partial<SecurityPlaybookApprovalAsk> = {},
): SecurityPlaybookApprovalAsk {
  return {
    caseNumber: "SEC-12",
    caseTitle: "Credential stuffing",
    caseUrl:
      "https://oneuptime.test/dashboard/p/security-events/cases/c/playbook-runs",
    action: SecurityPlaybookActionType.SuspendOktaUser,
    connectionName: "Okta (acme)",
    targets: [
      {
        value: "alice@acme.com",
        reason: SecurityPlaybookTargetReason.GroupedOn,
        state: SecurityPlaybookTargetState.Proposed,
      },
    ],
    source: {
      kind: SecurityPlaybookApprovalSourceKind.Playbook,
      playbookName: "Contain account takeover",
      trigger: SecurityPlaybookTrigger.CaseOpened,
    },
    evidence: [{ kind: SecurityPlaybookApprovalEvidenceKind.NotProtected }],
    undoAction: SecurityPlaybookActionType.UnsuspendOktaUser,
    standing: { kind: SecurityPlaybookApprovalStandingKind.Waiting },
    ...overrides,
  };
}

function readOf(
  ask: SecurityPlaybookApprovalAsk,
): SecurityPlaybookApprovalRead {
  return {
    round: ROUND,
    ask,
    run: new SecurityPlaybookRun(),
    step: STEP,
    result: {
      stepId: "contain",
      action: SecurityPlaybookActionType.SuspendOktaUser,
      status: SecurityPlaybookStepStatus.WaitingForApproval,
    },
  };
}

const WAITING: SecurityPlaybookApprovalRead = readOf(askOf());
const APPROVED: SecurityPlaybookApprovalRead = readOf(
  askOf({
    standing: {
      kind: SecurityPlaybookApprovalStandingKind.Approved,
      deciderName: "Jane Doe",
      decidedAt: new Date("2026-11-20T10:43:00.000Z"),
    },
  }),
);

// The message of the round as it reads in a workspace and language.
function blocksOf(
  read: SecurityPlaybookApprovalRead,
  workspaceType: WorkspaceType,
  language: string,
): Array<WorkspaceMessageBlock> {
  return WorkspaceSecurityPlaybookApproval.getMessage({
    ask: read.ask,
    round: read.round,
    workspaceType,
    language,
  }).messageBlocks;
}

function auth(
  workspaceType: WorkspaceType,
  workspaceProjectId: string,
): WorkspaceProjectAuthToken {
  const token: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
  token.projectId = PROJECT_ID;
  token.workspaceType = workspaceType;
  token.authToken = `${workspaceType}-token`;
  token.workspaceProjectId = workspaceProjectId;
  return token;
}

const SLACK_PLACE: WorkspaceMessagePayload = {
  _type: "WorkspaceMessagePayload",
  workspaceType: WorkspaceType.Slack,
  messageBlocks: [],
  channelNames: [],
  channelIds: ["C0SOC"],
};
const TEAMS_PLACE: WorkspaceMessagePayload = {
  _type: "WorkspaceMessagePayload",
  workspaceType: WorkspaceType.MicrosoftTeams,
  messageBlocks: [],
  channelNames: [],
  channelIds: ["19:soc@thread.tacv2"],
  teamId: "team-1",
};

let store: InMemoryLiveMessages;
let places: Map<WorkspaceType, Array<WorkspaceMessagePayload> | Error>;
let posted: Array<WorkspaceMessagePayload>;
let current: SecurityPlaybookApprovalRead | null;
let readSpy: SpyInstance<typeof SecurityPlaybookApprovalReader.read>;
// What Slack and the Bot Framework were asked to edit.
type SlackEdit = Parameters<typeof SlackUtil.updateMessage>[0];
type TeamsEdit = Parameters<typeof MicrosoftTeamsUtil.updateMessage>[0];

let slackEdits: Array<SlackEdit>;
let teamsEdits: Array<TeamsEdit>;

beforeEach(() => {
  store = new InMemoryLiveMessages();
  store.install();
  places = new Map([
    [WorkspaceType.Slack, [SLACK_PLACE]],
    [WorkspaceType.MicrosoftTeams, [TEAMS_PLACE]],
  ]);
  posted = [];
  current = WAITING;
  slackEdits = [];
  teamsEdits = [];

  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuths")
    .mockResolvedValue([
      auth(WorkspaceType.Slack, "T0TEAM"),
      auth(WorkspaceType.MicrosoftTeams, TENANT_ID),
    ] as never);
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockImplementation((async (data: { workspaceType: WorkspaceType }) => {
      return auth(
        data.workspaceType,
        data.workspaceType === WorkspaceType.Slack ? "T0TEAM" : TENANT_ID,
      );
    }) as never);
  jest
    .spyOn(WorkspaceNotificationRuleService, "getMessageDestinations")
    .mockImplementation((async (data: { workspaceType: WorkspaceType }) => {
      const found: Array<WorkspaceMessagePayload> | Error | undefined =
        places.get(data.workspaceType);

      if (found instanceof Error) {
        throw found;
      }

      return found || [];
    }) as never);
  jest
    .spyOn(WorkspaceNotificationRuleService, "logSendResponses")
    .mockResolvedValue(undefined);
  jest
    .spyOn(WorkspaceUtil, "postMessageToAllWorkspaceChannelsAsBot")
    .mockImplementation((async (data: {
      messagePayloadsByWorkspace: Array<WorkspaceMessagePayload>;
    }): Promise<Array<WorkspaceSendMessageResponse>> => {
      const payload: WorkspaceMessagePayload =
        data.messagePayloadsByWorkspace[0]!;

      posted.push(payload);

      return [
        {
          workspaceType: payload.workspaceType,
          threads: [
            {
              channel: {
                id: payload.channelIds![0]!,
                name: "soc",
                workspaceType: payload.workspaceType,
              },
              threadId: `posted-${posted.length}`,
            },
          ],
        },
      ];
    }) as never);
  readSpy = jest
    .spyOn(SecurityPlaybookApprovalReader, "read")
    .mockImplementation(async () => {
      return current;
    });
  jest
    .spyOn(SlackUtil, "updateMessage")
    .mockImplementation(
      async (data: Parameters<typeof SlackUtil.updateMessage>[0]) => {
        slackEdits.push(data);
      },
    );
  jest
    .spyOn(MicrosoftTeamsUtil, "updateMessage")
    .mockImplementation(
      async (data: Parameters<typeof MicrosoftTeamsUtil.updateMessage>[0]) => {
        teamsEdits.push(data);
      },
    );
  jest
    .spyOn(Semaphore, "lock")
    .mockRejectedValue(new Error("no Valkey in this test"));
});

afterEach(async () => {
  await WorkspaceSecurityPlaybookApprovalMessages.settle();
  jest.restoreAllMocks();
});

describe("posting the approval where the case's rules name for approvals", () => {
  test("in every workspace the project is connected to, in English, kept under the step's key", async () => {
    await expect(
      WorkspaceSecurityPlaybookApprovalMessages.postToChannels({
        read: WAITING,
      }),
    ).resolves.toBe(2);

    // Asked of the rules for the approval notice, about this case.
    for (const call of jest.mocked(
      WorkspaceNotificationRuleService.getMessageDestinations,
    ).mock.calls) {
      expect(call[0]).toMatchObject({
        projectId: PROJECT_ID,
        notificationFor: { securityCaseId: ROUND.securityCaseId },
        updateKinds: [NotificationRuleUpdateKind.ApprovalRequested],
      });
    }

    expect(
      posted.map((payload: WorkspaceMessagePayload) => {
        return [payload.workspaceType, payload.messageBlocks];
      }),
    ).toEqual([
      [WorkspaceType.Slack, blocksOf(WAITING, WorkspaceType.Slack, "en")],
      [
        WorkspaceType.MicrosoftTeams,
        blocksOf(WAITING, WorkspaceType.MicrosoftTeams, "en"),
      ],
    ]);
    expect(posted[0]!.text).toBe(
      WorkspaceSecurityPlaybookApproval.getMessage({
        ask: WAITING.ask,
        round: ROUND,
        workspaceType: WorkspaceType.Slack,
        language: "en",
      }).notificationText,
    );

    expect(
      store.forKey(KEY).map((row: WorkspaceLiveMessage) => {
        return [row.workspaceType, row.channelId, row.messageData];
      }),
    ).toEqual([
      [WorkspaceType.Slack, "C0SOC", { language: "en" }],
      [WorkspaceType.MicrosoftTeams, "19:soc@thread.tacv2", { language: "en" }],
    ]);

    // Still waiting once kept: nothing to edit.
    expect(slackEdits).toEqual([]);
    expect(teamsEdits).toEqual([]);
  });

  test("decided while it was being posted, every copy is drawn again at once", async () => {
    current = APPROVED;

    await WorkspaceSecurityPlaybookApprovalMessages.postToChannels({
      read: WAITING,
    });

    expect(
      slackEdits.map((edit: SlackEdit) => {
        return edit.messageBlocks;
      }),
    ).toEqual([blocksOf(APPROVED, WorkspaceType.Slack, "en")]);
    expect(
      teamsEdits.map((edit: TeamsEdit) => {
        return edit.messageBlocks;
      }),
    ).toEqual([blocksOf(APPROVED, WorkspaceType.MicrosoftTeams, "en")]);
  });

  test("a workspace whose rules cannot be read is left out; the other still gets it", async () => {
    places.set(WorkspaceType.Slack, new Error("rules unreadable"));

    await expect(
      WorkspaceSecurityPlaybookApprovalMessages.postToChannels({
        read: WAITING,
      }),
    ).resolves.toBe(1);

    expect(
      store.rows.map((row: WorkspaceLiveMessage) => {
        return row.workspaceType;
      }),
    ).toEqual([WorkspaceType.MicrosoftTeams]);
  });

  test("a place it cannot be posted in is left out; the next place still gets it", async () => {
    places.set(WorkspaceType.Slack, [
      { ...SLACK_PLACE, channelIds: ["C0ARCHIVED"] },
      SLACK_PLACE,
    ]);
    jest
      .mocked(WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot)
      .mockRejectedValueOnce(new BadRequestException("is_archived"));

    await expect(
      WorkspaceSecurityPlaybookApprovalMessages.postToChannels({
        read: WAITING,
      }),
    ).resolves.toBe(2);

    expect(
      store.rows.map((row: WorkspaceLiveMessage) => {
        return row.channelId;
      }),
    ).toEqual(["C0SOC", "19:soc@thread.tacv2"]);
  });

  test("no rule names a place for approvals: nothing posted, and the run is not read again", async () => {
    places = new Map();

    await expect(
      WorkspaceSecurityPlaybookApprovalMessages.postToChannels({
        read: WAITING,
      }),
    ).resolves.toBe(0);

    expect(posted).toEqual([]);
    expect(readSpy).not.toHaveBeenCalled();
  });
});

describe("keeping each approver's direct message as it lands", () => {
  test("Slack: kept as its channel, in the approver's language, with who it is for and the workspace it went through", async () => {
    const blocks: Array<WorkspaceMessageBlock> = blocksOf(
      WAITING,
      WorkspaceType.Slack,
      "de",
    );

    await WorkspaceSecurityPlaybookApprovalMessages.keepDirectMessage({
      read: WAITING,
      userId: JANE,
      language: "de",
      messageBlocks: blocks,
      sent: {
        workspaceType: WorkspaceType.Slack,
        workspaceProjectId: "T0TEAM",
        channelId: "D0JANE",
        messageId: "1760000000.000300",
      },
    });

    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({
      projectId: PROJECT_ID,
      workspaceType: WorkspaceType.Slack,
      messageKey: KEY,
      destinationType: WorkspaceLiveMessageDestinationType.Channel,
      channelId: "D0JANE",
      messageId: "1760000000.000300",
      contentHash: WorkspaceLiveMessages.getContentHash(blocks),
    });
    expect(store.rows[0]!.messageData).toEqual({
      language: "de",
      directMessageUserId: JANE.toString(),
      workspaceProjectId: "T0TEAM",
    });
    // Still waiting: nothing to edit.
    expect(slackEdits).toEqual([]);
  });

  test("Microsoft Teams: kept as a personal chat, with the Bot Framework service it is at", async () => {
    await WorkspaceSecurityPlaybookApprovalMessages.keepDirectMessage({
      read: WAITING,
      userId: JANE,
      language: "en",
      messageBlocks: blocksOf(WAITING, WorkspaceType.MicrosoftTeams, "en"),
      sent: {
        workspaceType: WorkspaceType.MicrosoftTeams,
        workspaceProjectId: TENANT_ID,
        channelId: "a:1personal-chat",
        messageId: "1760000000001",
        serviceUrl: "https://smba.trafficmanager.net/emea/",
      },
    });

    expect(store.rows[0]).toMatchObject({
      destinationType: WorkspaceLiveMessageDestinationType.Chat,
      channelId: "a:1personal-chat",
    });
    expect(store.rows[0]!.messageData).toEqual({
      language: "en",
      directMessageUserId: JANE.toString(),
      workspaceProjectId: TENANT_ID,
      serviceUrl: "https://smba.trafficmanager.net/emea/",
    });
  });

  test("decided while it was on its way: drawn again at once, in the approver's language", async () => {
    current = APPROVED;

    await WorkspaceSecurityPlaybookApprovalMessages.keepDirectMessage({
      read: WAITING,
      userId: JANE,
      language: "de",
      messageBlocks: blocksOf(WAITING, WorkspaceType.Slack, "de"),
      sent: {
        workspaceType: WorkspaceType.Slack,
        workspaceProjectId: "T0TEAM",
        channelId: "D0JANE",
        messageId: "1760000000.000300",
      },
    });

    expect(slackEdits).toHaveLength(1);
    expect(slackEdits[0]!.location.channelId).toBe("D0JANE");
    expect(slackEdits[0]!.messageBlocks).toEqual(
      blocksOf(APPROVED, WorkspaceType.Slack, "de"),
    );
    expect(JSON.stringify(slackEdits[0]!.messageBlocks)).toContain(
      "Von Jane Doe um",
    );
  });

  test.each([
    ["no id at all", ""],
    ["an id no column can keep whole", `D${"0".repeat(600)}`],
  ])(
    "where it landed cannot be kept (%s): nothing is kept, and nothing edited",
    async (_name: string, channelId: string) => {
      current = APPROVED;

      await WorkspaceSecurityPlaybookApprovalMessages.keepDirectMessage({
        read: WAITING,
        userId: JANE,
        language: "en",
        messageBlocks: blocksOf(WAITING, WorkspaceType.Slack, "en"),
        sent: {
          workspaceType: WorkspaceType.Slack,
          workspaceProjectId: "T0TEAM",
          channelId,
          messageId: "1760000000.000300",
        },
      });

      expect(store.rows).toEqual([]);
      expect(slackEdits).toEqual([]);
    },
  );

  test("a row that cannot be written loses the edit, never the message: nothing throws", async () => {
    current = APPROVED;
    jest
      .mocked(WorkspaceLiveMessageService.create)
      .mockRejectedValueOnce(new Error("database unavailable"));

    await expect(
      WorkspaceSecurityPlaybookApprovalMessages.keepDirectMessage({
        read: WAITING,
        userId: JANE,
        language: "en",
        messageBlocks: blocksOf(WAITING, WorkspaceType.Slack, "en"),
        sent: {
          workspaceType: WorkspaceType.Slack,
          workspaceProjectId: "T0TEAM",
          channelId: "D0JANE",
          messageId: "1760000000.000300",
        },
      }),
    ).resolves.toBeUndefined();

    expect(store.rows).toEqual([]);
    expect(slackEdits).toEqual([]);
  });
});

describe("drawing every copy again when the approval moves on", () => {
  function keep(data: {
    workspaceType: WorkspaceType;
    channelId: string;
    language: string;
    directMessageUserId?: string;
    workspaceProjectId?: string;
    serviceUrl?: string;
  }): void {
    const row: WorkspaceLiveMessage = new WorkspaceLiveMessage();
    row.id = ObjectID.generate();
    row.projectId = PROJECT_ID;
    row.workspaceType = data.workspaceType;
    row.messageKey = KEY;
    row.destinationType = data.channelId.startsWith("a:")
      ? WorkspaceLiveMessageDestinationType.Chat
      : WorkspaceLiveMessageDestinationType.Channel;
    row.channelId = data.channelId;
    row.messageId = `message-in-${data.channelId}`;
    row.contentHash = WorkspaceLiveMessages.getContentHash(
      blocksOf(WAITING, data.workspaceType, data.language),
    );
    row.messageData = {
      language: data.language,
      ...(data.directMessageUserId
        ? { directMessageUserId: data.directMessageUserId }
        : {}),
      ...(data.workspaceProjectId
        ? { workspaceProjectId: data.workspaceProjectId }
        : {}),
      ...(data.serviceUrl ? { serviceUrl: data.serviceUrl } : {}),
    };
    store.rows.push(row);
  }

  beforeEach(() => {
    keep({
      workspaceType: WorkspaceType.Slack,
      channelId: "C0SOC",
      language: "en",
    });
    keep({
      workspaceType: WorkspaceType.Slack,
      channelId: "D0JANE",
      language: "de",
      directMessageUserId: JANE.toString(),
      workspaceProjectId: "T0TEAM",
    });
    keep({
      workspaceType: WorkspaceType.MicrosoftTeams,
      channelId: "a:1personal-chat",
      language: "en",
      directMessageUserId: JANE.toString(),
      workspaceProjectId: TENANT_ID,
      serviceUrl: "https://smba.trafficmanager.net/emea/",
    });
  });

  test("each copy in its own chat, its own language, through its own workspace", async () => {
    current = APPROVED;

    await expect(
      WorkspaceSecurityPlaybookApprovalMessages.refreshStep({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        stepIndex: 1,
      }),
    ).resolves.toBe(3);

    expect(readSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      runId: RUN_ID,
      stepIndex: 1,
    });
    expect(
      slackEdits.map((edit: SlackEdit) => {
        return [edit.location.channelId, edit.messageBlocks];
      }),
    ).toEqual([
      ["C0SOC", blocksOf(APPROVED, WorkspaceType.Slack, "en")],
      ["D0JANE", blocksOf(APPROVED, WorkspaceType.Slack, "de")],
    ]);
    expect(teamsEdits).toHaveLength(1);
    expect(teamsEdits[0]!.location).toEqual({
      channelId: "a:1personal-chat",
      teamId: undefined,
      isChat: true,
      serviceUrl: "https://smba.trafficmanager.net/emea/",
    });
    expect(teamsEdits[0]!.messageBlocks).toEqual(
      blocksOf(APPROVED, WorkspaceType.MicrosoftTeams, "en"),
    );

    // Drawn again with nothing new: nothing sent.
    await expect(
      WorkspaceSecurityPlaybookApprovalMessages.refreshStep({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        stepIndex: 1,
      }),
    ).resolves.toBe(0);
    expect(slackEdits).toHaveLength(2);
  });

  test("a copy that cannot be edited is skipped; every other copy is still edited", async () => {
    current = APPROVED;
    jest
      .mocked(SlackUtil.updateMessage)
      .mockRejectedValueOnce(
        new BadRequestException("Error from Slack is_archived"),
      );

    await expect(
      WorkspaceSecurityPlaybookApprovalMessages.refreshStep({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        stepIndex: 1,
      }),
    ).resolves.toBe(2);

    expect(
      slackEdits.map((edit: SlackEdit) => {
        return edit.location.channelId;
      }),
    ).toEqual(["D0JANE"]);
    expect(teamsEdits).toHaveLength(1);
  });

  test("a direct message sent through a workspace the project is no longer connected to is left as it is", async () => {
    current = APPROVED;
    jest
      .mocked(WorkspaceProjectAuthTokenService.getProjectAuth)
      .mockImplementation((async (data: { workspaceType: WorkspaceType }) => {
        return auth(data.workspaceType, "T0ANOTHER");
      }) as never);

    await WorkspaceSecurityPlaybookApprovalMessages.refreshStep({
      projectId: PROJECT_ID,
      runId: RUN_ID,
      stepIndex: 1,
    });

    /*
     * The channel post goes through the project's connection, as every
     * channel post does. Jane's direct messages were sent through other
     * workspaces than the one the project is connected to now: left alone.
     */
    expect(
      slackEdits.map((edit: SlackEdit) => {
        return edit.location.channelId;
      }),
    ).toEqual(["C0SOC"]);
    expect(teamsEdits).toEqual([]);
  });

  test("gone with its run or its case: nothing is edited", async () => {
    current = null;

    await expect(
      WorkspaceSecurityPlaybookApprovalMessages.refreshStep({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        stepIndex: 1,
      }),
    ).resolves.toBe(0);

    expect(slackEdits).toEqual([]);
    expect(teamsEdits).toEqual([]);
  });

  test("a step nobody kept a copy of: the run is not read", async () => {
    await expect(
      WorkspaceSecurityPlaybookApprovalMessages.refreshStep({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        stepIndex: 2,
      }),
    ).resolves.toBe(0);

    expect(readSpy).not.toHaveBeenCalled();
  });

  test("a failure to read never reaches whoever changed the approval", async () => {
    readSpy.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(
      WorkspaceSecurityPlaybookApprovalMessages.refreshStep({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        stepIndex: 1,
      }),
    ).resolves.toBe(0);
  });
});

describe("which of a run's steps are drawn again", () => {
  function runWith(
    results: Array<SecurityPlaybookStepResult>,
    currentStepIndex: number,
  ): SecurityPlaybookRun {
    const run: SecurityPlaybookRun = new SecurityPlaybookRun();
    run._id = RUN_ID.toString();
    run.projectId = PROJECT_ID;
    run.status = SecurityPlaybookRunStatus.Running;
    run.steps = [0, 1, 2, 3].map((index: number): SecurityPlaybookStep => {
      return { ...STEP, id: `step-${index}` };
    }) as never;
    run.stepResults = results as never;
    run.currentStepIndex = currentStepIndex;
    return run;
  }

  test("each step that was asked about - decided, waiting, or the one the run is on - and no other", async () => {
    const refreshStep: SpyInstance<
      typeof WorkspaceSecurityPlaybookApprovalMessages.refreshStep
    > = jest
      .spyOn(WorkspaceSecurityPlaybookApprovalMessages, "refreshStep")
      .mockResolvedValue(1);
    jest.spyOn(SecurityPlaybookApprovalReader, "readRun").mockResolvedValue(
      runWith(
        [
          {
            stepId: "step-0",
            action: SecurityPlaybookActionType.SuspendOktaUser,
            status: SecurityPlaybookStepStatus.Succeeded,
            approval: {
              decision: SecurityPlaybookApprovalDecision.Approved,
              decidedByUserId: JANE.toString(),
              decidedAt: "2026-11-20T10:43:00.000Z",
            },
          },
          {
            stepId: "step-1",
            action: SecurityPlaybookActionType.SuspendOktaUser,
            status: SecurityPlaybookStepStatus.Succeeded,
          },
          {
            stepId: "step-2",
            action: SecurityPlaybookActionType.SuspendOktaUser,
            status: SecurityPlaybookStepStatus.Running,
          },
          {
            stepId: "step-3",
            action: SecurityPlaybookActionType.SuspendOktaUser,
            status: SecurityPlaybookStepStatus.Pending,
          },
        ],
        2,
      ),
    );

    await expect(
      WorkspaceSecurityPlaybookApprovalMessages.refreshRun({
        projectId: PROJECT_ID,
        runId: RUN_ID,
      }),
    ).resolves.toBe(2);

    expect(
      refreshStep.mock.calls.map(
        (
          call: Parameters<
            typeof WorkspaceSecurityPlaybookApprovalMessages.refreshStep
          >,
        ) => {
          return call[0].stepIndex;
        },
      ),
    ).toEqual([0, 2]);
  });

  test("a run that is gone: nothing", async () => {
    jest
      .spyOn(SecurityPlaybookApprovalReader, "readRun")
      .mockResolvedValue(null);
    const refreshStep: SpyInstance<
      typeof WorkspaceSecurityPlaybookApprovalMessages.refreshStep
    > = jest.spyOn(WorkspaceSecurityPlaybookApprovalMessages, "refreshStep");

    await expect(
      WorkspaceSecurityPlaybookApprovalMessages.refreshRun({
        projectId: PROJECT_ID,
        runId: RUN_ID,
      }),
    ).resolves.toBe(0);
    expect(refreshStep).not.toHaveBeenCalled();
  });

  test("in the background: the caller goes on at once, a failure never reaches it, and settle waits for it", async () => {
    let finished: boolean = false;

    jest
      .spyOn(WorkspaceSecurityPlaybookApprovalMessages, "refreshRun")
      .mockImplementation(async () => {
        await Promise.resolve();
        finished = true;
        throw new Error("Slack is down");
      });

    expect(() => {
      WorkspaceSecurityPlaybookApprovalMessages.refreshInBackground({
        projectId: PROJECT_ID,
        runId: RUN_ID,
      });
    }).not.toThrow();
    expect(finished).toBe(false);

    await WorkspaceSecurityPlaybookApprovalMessages.settle();

    expect(finished).toBe(true);
  });
});
