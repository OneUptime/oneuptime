import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import WorkspaceProjectAuthToken from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import WorkspaceProjectAuthTokenService from "../../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../../../Server/Services/WorkspaceUserAuthTokenService";
import {
  ExpressRequest,
  ExpressResponse,
} from "../../../../../Server/Utils/Express";
import Response from "../../../../../Server/Utils/Response";
import SlackActionType from "../../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import SlackAuthAction, {
  SlackAuthRefusalReason,
  SlackRequest,
} from "../../../../../Server/Utils/Workspace/Slack/Actions/Auth";
import SlackConnectPrompt from "../../../../../Server/Utils/Workspace/Slack/Actions/ConnectPrompt";
import SlackPublicNoteApprovalActions from "../../../../../Server/Utils/Workspace/Slack/Actions/PublicNoteApproval";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import SlackModalMetadata from "../../../../../Server/Utils/Workspace/Slack/SlackModalMetadata";
import WorkspaceActionAuthorization from "../../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceConnectCompletion, {
  WorkspaceConnectCompletionResult,
} from "../../../../../Server/Utils/Workspace/WorkspaceConnectCompletion";
import WorkspaceConnectRequest, {
  WorkspacePendingActionKind,
} from "../../../../../Server/Utils/Workspace/WorkspaceConnectRequest";
import { PUBLIC_NOTE_REJECT_REASON_FIELD } from "../../../../../Server/Utils/Workspace/WorkspacePublicNoteApproval";
import WorkspacePublicNoteApprovalActions from "../../../../../Server/Utils/Workspace/WorkspacePublicNoteApprovalActions";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH,
  PublicNoteApprovalGiven,
  PublicNoteApprovalMessages,
  PublicNoteApprovalStatus,
} from "../../../../../Types/StatusPage/PublicNoteApproval";
import { ConnectRequestOutcome } from "../../../../../Types/Workspace/ConnectCallback";
import {
  WorkspaceModalBlock,
  WorkspacePayloadMarkdown,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import {
  ALICE,
  BOB,
  CAROL,
  DAVE,
  EVE,
  NOTES_URL,
  OTHER_PROJECT_ID,
  PROJECT_ID,
  SUPPORT,
  encodedValue,
  restoreWorld,
  startWorld,
  storedRound,
  world,
} from "./PublicNoteApprovalChatWorld";

/*
 * APPROVE AND REJECT IN SLACK (#6289): a public note's approval message, in
 * an approver's direct messages with the app, pressed - through
 * SlackPublicNoteApprovalActions, over the real engine and one note in
 * memory.
 *
 *  - Slack is answered at once; the press is answered where it was made,
 *    only to the presser (its response_url, in the direct message).
 *  - Approve decides as the member who pressed: to the next step, or
 *    published. Reject opens a modal that asks why; a reason that is
 *    missing or too long keeps it open, saying why under the field; one
 *    that is not rejects the note.
 *  - Every refusal is the engine's words; a late press is news; two at
 *    once decide once; a forged, replayed or stale press decides nothing.
 *  - In a workspace connected to several projects, the press is read in
 *    the one its value was signed for; an account not connected is asked
 *    to connect, and its Approve is decided once it is.
 */

type AnySpy = SpyInstance<(...args: Array<any>) => any>;

const RESPONSE_URL: string = "https://hooks.slack.com/actions/T0TEAM/1/abc";
const DIRECT_CHANNEL: string = "D0DIRECT";
const SLACK_TEAM_ID: string = "T0TEAM";

let responded: AnySpy;
let answered: AnySpy;
let ephemeral: AnySpy;
let modal: AnySpy;

function slackRequest(
  userId: string,
  overrides: Partial<SlackRequest> = {},
): SlackRequest {
  return {
    isAuthorized: true,
    userId: new ObjectID(userId),
    projectId: PROJECT_ID,
    projectAuthToken: "xoxb-project-token",
    slackTeamId: SLACK_TEAM_ID,
    slackUserId: `U0${userId.slice(0, 6).toUpperCase()}`,
    slackChannelId: DIRECT_CHANNEL,
    responseUrl: RESPONSE_URL,
    triggerId: "trigger-1",
    payloadType: "block_actions",
    ...overrides,
  };
}

async function press(
  userId: string,
  actionType: SlackActionType,
  actionValue: string,
  overrides: Partial<SlackRequest> = {},
): Promise<void> {
  await SlackPublicNoteApprovalActions.handlePublicNoteApprovalAction({
    slackRequest: slackRequest(userId, overrides),
    action: { actionType: actionType, actionValue: actionValue },
    req: {} as ExpressRequest,
    res: {} as ExpressResponse,
  });
}

async function submitReject(
  userId: string,
  actionValue: string,
  reason: unknown,
): Promise<void> {
  await press(userId, SlackActionType.SubmitRejectPublicNote, actionValue, {
    payloadType: "view_submission",
    responseUrl: undefined,
    viewValues:
      reason === undefined
        ? {}
        : { [PUBLIC_NOTE_REJECT_REASON_FIELD]: reason as string },
  });
}

// What the presser was told, only to them, where they pressed.
function answers(): Array<string> {
  return [...answered.mock.calls, ...ephemeral.mock.calls].map(
    (call: Array<any>): string => {
      return (
        (call[0] as { messageBlocks: Array<WorkspacePayloadMarkdown> })
          .messageBlocks[0] as WorkspacePayloadMarkdown
      ).text;
    },
  );
}

// The same, as the plain text its notification shows: a refusal's own words.
function answerTexts(): Array<string> {
  return [...answered.mock.calls, ...ephemeral.mock.calls].map(
    (call: Array<any>): string => {
      return (call[0] as { text: string }).text;
    },
  );
}

function slackResponses(): Array<unknown> {
  return responded.mock.calls.map((call: Array<any>) => {
    return call[2];
  });
}

beforeEach(() => {
  startWorld();
  responded = jest
    .spyOn(Response, "sendJsonObjectResponse")
    .mockImplementation(() => {}) as AnySpy;
  jest.spyOn(Response, "sendErrorResponse").mockImplementation(() => {});
  answered = jest
    .spyOn(SlackUtil, "sendEphemeralResponse")
    .mockResolvedValue(undefined as never) as AnySpy;
  ephemeral = jest
    .spyOn(SlackUtil, "sendEphemeralMessageToChannel")
    .mockResolvedValue(undefined as never) as AnySpy;
  jest
    .spyOn(SlackUtil, "sendDirectMessageToUser")
    .mockResolvedValue(undefined as never);
  modal = jest
    .spyOn(SlackUtil, "showModalToUser")
    .mockResolvedValue(undefined as never) as AnySpy;
});

afterEach(() => {
  restoreWorld();
});

describe("Approve, in a direct message", () => {
  test("Slack is answered at once; the step is approved as the member who pressed; only they are told, where they pressed", async () => {
    await press(BOB, SlackActionType.ApprovePublicNote, encodedValue());

    expect(slackResponses()).toEqual([{ response_action: "clear" }]);
    expect(
      storedRound().approvals.map((given: PublicNoteApprovalGiven): string => {
        return given.userId;
      }),
    ).toEqual([BOB]);
    expect(answers()).toEqual([
      `✅ You approved a **public note** on [Incident INC-42](${NOTES_URL}) for step 1 of 2 (Support). It waits for step 2 of 2 (Legal): Carol.`,
    ]);
    expect(answered.mock.calls[0]![0]).toMatchObject({
      responseUrl: RESPONSE_URL,
    });
    expect(world.asked).toEqual([[CAROL]]);
    expect(world.logged).toEqual(["approve_public_note"]);
  });

  test("on the last step: published, and said so", async () => {
    await press(BOB, SlackActionType.ApprovePublicNote, encodedValue());
    await press(CAROL, SlackActionType.ApprovePublicNote, encodedValue());

    expect(world.stored.isPublished).toBe(true);
    expect(answers()[1]).toBe(
      `✅ You approved a **public note** on [Incident INC-42](${NOTES_URL}). It is now published on status pages.`,
    );
    expect(world.published).toHaveLength(1);
  });

  test.each([
    {
      who: "the person who sent it",
      userId: ALICE,
      arrange: (): void => {
        world.steps = [{ ...SUPPORT, userIds: [ALICE, BOB] }];
      },
      told: PublicNoteApprovalMessages.sentByYou,
    },
    {
      who: "somebody the step does not name",
      userId: EVE,
      arrange: (): void => {},
      told: PublicNoteApprovalMessages.notAnApprover('step 1 ("Support")'),
    },
  ])(
    "$who is told why, in the engine's words, and nothing is written",
    async ({
      userId,
      arrange,
      told,
    }: {
      userId: string;
      arrange: () => void;
      told: string;
    }): Promise<void> => {
      arrange();

      await press(userId, SlackActionType.ApprovePublicNote, encodedValue());

      expect(answerTexts()).toEqual([told]);
      expect(world.writes).toEqual([]);
      expect(world.logged).toEqual([]);
    },
  );

  test("an approver of an earlier step is told why they cannot approve this one", async () => {
    world.steps = [SUPPORT, { ...world.steps[1]!, userIds: [BOB, CAROL] }];
    await press(BOB, SlackActionType.ApprovePublicNote, encodedValue());

    await press(BOB, SlackActionType.ApprovePublicNote, encodedValue());

    expect(answerTexts()[1]).toBe(
      PublicNoteApprovalMessages.approvedEarlierStep,
    );
    expect(world.writes).toHaveLength(1);
  });

  test("a member whose access does not include the note, or a note deleted since, decides nothing", async () => {
    world.readers.delete(DAVE);
    await press(DAVE, SlackActionType.ApprovePublicNote, encodedValue());

    world.exists = false;
    await press(BOB, SlackActionType.ApprovePublicNote, encodedValue());

    expect(answerTexts()).toEqual([
      `You do not have permission to approve this public note: ${WorkspaceActionAuthorization.getNotIncludedReason("incident public note")}`,
      "This public note is no longer in OneUptime. It may have been deleted.",
    ]);
    expect(world.writes).toEqual([]);
  });

  test("somebody no longer a member of the project is told so, and nothing is read or written", async () => {
    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockRejectedValue(
        new NotAuthorizedException(
          WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
        ) as never,
      );

    await press(BOB, SlackActionType.ApprovePublicNote, encodedValue());

    expect(answerTexts()).toEqual([
      WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
    ]);
    expect(world.writes).toEqual([]);
  });

  test("two approvers at the same moment: one approves, the other is told what was decided", async () => {
    world.steps = [SUPPORT];
    const value: string = encodedValue();
    const asBothRead: typeof world.stored = { ...world.stored };

    await press(BOB, SlackActionType.ApprovePublicNote, value);
    world.readsAsOf = asBothRead;
    await press(DAVE, SlackActionType.ApprovePublicNote, value);

    expect(answers()[0]).toContain("You approved a **public note**");
    expect(answers()[1]).toMatch(
      /^✅ This public note on .+ was already approved by \*\*Bob\*\* at .+\. It is published on status pages\.$/,
    );
    expect(world.writes).toHaveLength(1);
    expect(world.published).toHaveLength(1);
    expect(world.logged).toEqual(["approve_public_note"]);
  });

  test("approval switched off since, the note still waiting: decided, as the Dashboard decides it", async () => {
    world.isRequired = false;

    await press(BOB, SlackActionType.ApprovePublicNote, encodedValue());

    expect(
      storedRound().approvals.map((given: PublicNoteApprovalGiven): string => {
        return given.userId;
      }),
    ).toEqual([BOB]);
    expect(answerTexts()).toEqual(["You approved a public note for its step"]);
  });

  test("published without approval once approval was switched off: news, and nothing decided", async () => {
    const value: string = encodedValue();
    world.isRequired = false;
    world.stored = {
      ...world.stored,
      isPublished: true,
      approvalStatus: null,
      approval: null,
    };

    await press(BOB, SlackActionType.ApprovePublicNote, value);

    expect(answers()).toEqual([
      `This public note on [Incident INC-42](${NOTES_URL}) no longer waits for approval, so nothing was decided.`,
    ]);
    expect(world.writes).toEqual([]);
  });

  test("a press on a note that changed since it was asked about is news, and decides nothing", async () => {
    const value: string = encodedValue();
    world.stored = { ...world.stored, note: "Rewritten." };

    await press(BOB, SlackActionType.ApprovePublicNote, value);

    expect(answers()[0]).toContain(
      "changed after you were asked about it, so nothing was decided.",
    );
    expect(world.writes).toEqual([]);
  });
});

describe("forged, replayed and stale presses", () => {
  test.each([
    [
      "an id where a value belongs",
      (): string => {
        return "44444444-4444-4444-8444-444444444444";
      },
    ],
    [
      "a value with its signature changed",
      (): string => {
        return `${encodedValue().slice(0, -3)}abc`;
      },
    ],
    [
      "nothing at all",
      (): string => {
        return "";
      },
    ],
  ])(
    "%s: told the button could not be verified, and nothing is read",
    async (_label: string, actionValue: () => string) => {
      const getHost: AnySpy =
        WorkspacePublicNoteApprovalActions.getHost as unknown as AnySpy;
      getHost.mockClear();

      await press(BOB, SlackActionType.ApprovePublicNote, actionValue());

      expect(answerTexts()).toEqual([
        WorkspacePublicNoteApprovalActions.getUnverifiedMessage(),
      ]);
      expect(getHost).not.toHaveBeenCalled();
      expect(world.writes).toEqual([]);
    },
  );

  test("a value signed for another project than the one the press was read in decides nothing", async () => {
    await press(
      BOB,
      SlackActionType.ApprovePublicNote,
      encodedValue({ projectId: OTHER_PROJECT_ID }),
    );

    expect(answerTexts()).toEqual([
      WorkspacePublicNoteApprovalActions.getUnverifiedMessage(),
    ]);
    expect(world.writes).toEqual([]);
  });

  test("the same press sent twice approves once, and the second is news", async () => {
    const value: string = encodedValue();

    await press(BOB, SlackActionType.ApprovePublicNote, value);
    await press(BOB, SlackActionType.ApprovePublicNote, value);

    expect(world.writes).toHaveLength(1);
    expect(answers()[1]).toContain(
      "was already approved for step 1 of 2 (Support) by **Bob**",
    );
  });
});

describe("Reject, and its modal", () => {
  test("Reject opens the modal that asks why, carrying the button's value and where it was pressed; nothing is decided yet", async () => {
    const value: string = encodedValue();

    await press(BOB, SlackActionType.ViewRejectPublicNote, value);

    expect(modal).toHaveBeenCalledTimes(1);

    const shown: WorkspaceModalBlock = (
      modal.mock.calls[0]![0] as { modalBlock: WorkspaceModalBlock }
    ).modalBlock;

    expect(shown.title).toBe("Reject this public note?");
    expect(shown.actionId).toBe(SlackActionType.SubmitRejectPublicNote);
    expect(SlackModalMetadata.read(shown.actionValue).value).toBe(value);
    expect(SlackModalMetadata.read(shown.actionValue).origin.channelId).toBe(
      DIRECT_CHANNEL,
    );
    expect(SlackModalMetadata.read(shown.actionValue).origin.projectId).toBe(
      PROJECT_ID.toString(),
    );
    expect(world.writes).toEqual([]);
  });

  test("the sender pressing Reject is told why, and no modal opens", async () => {
    world.steps = [{ ...SUPPORT, userIds: [ALICE, BOB] }];

    await press(ALICE, SlackActionType.ViewRejectPublicNote, encodedValue());

    expect(modal).not.toHaveBeenCalled();
    expect(answerTexts()).toEqual([PublicNoteApprovalMessages.sentByYou]);
  });

  test.each([
    ["no reason", undefined, PublicNoteApprovalMessages.reasonRequired],
    ["an empty reason", "   ", PublicNoteApprovalMessages.reasonRequired],
    [
      "a reason over the longest kept",
      "x".repeat(PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH + 1),
      `A reason may have at most ${PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH} characters.`,
    ],
  ])(
    "%s keeps the modal open, saying why under the field, and rejects nothing",
    async (_label: string, reason: unknown, told: string) => {
      await submitReject(BOB, encodedValue(), reason);

      expect(slackResponses()).toEqual([
        {
          response_action: "errors",
          errors: { [PUBLIC_NOTE_REJECT_REASON_FIELD]: told },
        },
      ]);
      expect(world.writes).toEqual([]);
      expect(answers()).toEqual([]);
    },
  );

  test("with a reason: the modal closes, the note is rejected, and the presser is told in their direct message", async () => {
    await submitReject(BOB, encodedValue(), "Do not name the vendor.");

    expect(slackResponses()).toEqual([{ response_action: "clear" }]);
    expect(world.stored.approvalStatus).toBe(PublicNoteApprovalStatus.Rejected);
    expect(storedRound().rejection?.reason).toBe("Do not name the vendor.");
    expect(answers()).toEqual([
      `↩️ You rejected a **public note** on [Incident INC-42](${NOTES_URL}). It is not published, and its author sees your reason.`,
    ]);
    // Only the presser sees it, in the direct message the modal was opened from.
    expect(ephemeral.mock.calls[0]![0]).toMatchObject({
      channelId: DIRECT_CHANNEL,
    });
    expect(world.logged).toEqual(["reject_public_note"]);
  });

  test("somebody who rejected it a moment earlier is news to the one who submits after", async () => {
    const value: string = encodedValue();
    const asBothRead: typeof world.stored = { ...world.stored };

    await submitReject(DAVE, value, "Hold it.");
    world.readsAsOf = asBothRead;
    await submitReject(BOB, value, "Not yet.");

    expect(answers()[1]).toContain("was already rejected by **Dave**");
    expect(world.writes).toHaveLength(1);
  });
});

describe("in a workspace connected to several projects", () => {
  test("the press is read in the project its value was signed for, not the first connected", async () => {
    const first: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
    first.projectId = OTHER_PROJECT_ID;
    first.authToken = "xoxb-other";
    first.workspaceProjectId = SLACK_TEAM_ID;

    const second: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
    second.projectId = PROJECT_ID;
    second.authToken = "xoxb-project-token";
    second.workspaceProjectId = SLACK_TEAM_ID;

    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findBy")
      .mockResolvedValue([first, second] as never);

    const userAuth: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
    userAuth.userId = new ObjectID(BOB);
    jest
      .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
      .mockResolvedValue(userAuth as never);
    jest
      .spyOn(WorkspaceActionAuthorization, "isProjectMember")
      .mockResolvedValue(true as never);

    const result: SlackRequest = await SlackAuthAction.isAuthorized({
      req: {
        body: {
          payload: JSON.stringify({
            type: "block_actions",
            user: { id: "U0BOB" },
            team: { id: SLACK_TEAM_ID },
            channel: { id: DIRECT_CHANNEL },
            response_url: RESPONSE_URL,
            actions: [
              {
                action_id: SlackActionType.ApprovePublicNote,
                value: encodedValue(),
              },
            ],
          }),
        },
      } as unknown as ExpressRequest,
    });

    expect(result.isAuthorized).toBe(true);
    expect(result.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(result.userId?.toString()).toBe(BOB);
  });
});

describe("a Slack account not connected yet", () => {
  test("Approve asks to connect - one click, and it is approved for them once they are", () => {
    const value: string = encodedValue();

    expect(
      SlackConnectPrompt.describe({
        actionType: SlackActionType.ApprovePublicNote,
        actionValue: value,
      }),
    ).toMatchObject({
      purpose: "approve this public note",
      pendingAction: {
        kind: WorkspacePendingActionKind.ApprovePublicNote,
        publicNoteApproval: value,
      },
    });
  });

  test("Reject asks to connect, then to press Reject again", () => {
    expect(
      SlackConnectPrompt.describe({
        actionType: SlackActionType.ViewRejectPublicNote,
        actionValue: encodedValue(),
      }),
    ).toEqual({
      purpose: "reject this public note",
      again: { kind: "Button", label: "Reject" },
    });
  });

  test("an account not connected is answered with the Connect prompt, and nothing is decided", async () => {
    jest
      .spyOn(WorkspaceConnectRequest, "getConnectLink")
      .mockResolvedValue({ button: "None" } as never);
    jest.spyOn(WorkspaceProjectAuthTokenService, "countBy").mockResolvedValue({
      toNumber: () => {
        return 1;
      },
    } as never);

    await SlackAuthAction.answerRefusal({
      ...slackRequest(BOB),
      isAuthorized: false,
      userId: undefined,
      refusal: {
        reason: SlackAuthRefusalReason.NotConnected,
        projectId: PROJECT_ID,
        action: {
          actionType: SlackActionType.ApprovePublicNote,
          actionValue: encodedValue(),
        },
      },
    });

    expect(answers()[0]).toContain(
      "**Connect your Slack account to approve this public note.**",
    );
    expect(world.writes).toEqual([]);
  });

  test("once connected, the Approve they pressed is decided as the member, and they are told", async () => {
    const value: string = encodedValue();

    const result: WorkspaceConnectCompletionResult =
      await WorkspaceConnectCompletion.complete({
        request: {
          workspaceType: WorkspaceType.Slack,
          projectId: PROJECT_ID,
          workspaceUserId: "U0BOB",
          purpose: "approve this public note",
          pendingAction: {
            kind: WorkspacePendingActionKind.ApprovePublicNote,
            eventType: "Incident" as never,
            eventId: new ObjectID("33333333-3333-4333-8333-333333333333"),
            publicNoteApproval: value,
          },
          slack: { channelId: DIRECT_CHANNEL, responseUrl: RESPONSE_URL },
          expiresAt: new Date(Date.now() + 60000),
        },
        userId: new ObjectID(BOB),
      });

    expect(result.outcome).toBe(ConnectRequestOutcome.Done);
    expect(result.answer.markdown).toBe(
      `✅ **Your Slack account is connected to OneUptime.** You approved a **public note** on [Incident INC-42](${NOTES_URL}) for step 1 of 2 (Support). It waits for step 2 of 2 (Legal): Carol.`,
    );
    expect(
      storedRound().approvals.map((given: PublicNoteApprovalGiven): string => {
        return given.userId;
      }),
    ).toEqual([BOB]);
    expect(world.logged).toEqual(["approve_public_note"]);
  });

  test("once connected, a note decided meanwhile is told as news, and counts as answered, not done", async () => {
    const value: string = encodedValue();
    world.stored = {
      ...world.stored,
      approvalStatus: PublicNoteApprovalStatus.Rejected,
      approval: {
        ...(world.stored.approval as JSONObject),
        rejection: {
          userId: DAVE,
          at: "2026-11-07T09:10:00.000Z",
          reason: "No",
        },
      },
    };

    const result: WorkspaceConnectCompletionResult =
      await WorkspaceConnectCompletion.complete({
        request: {
          workspaceType: WorkspaceType.Slack,
          projectId: PROJECT_ID,
          workspaceUserId: "U0BOB",
          purpose: "approve this public note",
          pendingAction: {
            kind: WorkspacePendingActionKind.ApprovePublicNote,
            eventType: "Incident" as never,
            eventId: new ObjectID("33333333-3333-4333-8333-333333333333"),
            publicNoteApproval: value,
          },
          expiresAt: new Date(Date.now() + 60000),
        },
        userId: new ObjectID(BOB),
      });

    expect(result.outcome).toBe(ConnectRequestOutcome.Answered);
    expect(result.answer.markdown).toContain(
      "was already rejected by **Dave**",
    );
    expect(world.writes).toEqual([]);
  });
});
