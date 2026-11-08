import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    MicrosoftTeamsAppClientId: "11111111-2222-3333-4444-555555555555",
    MicrosoftTeamsAppClientSecret: "test-secret",
    MicrosoftTeamsAppTenantId: "test-tenant",
  };
});

import type { SpyInstance } from "jest-mock";
import type { TurnContext } from "botbuilder";
import WorkspaceProjectAuthToken, {
  MicrosoftTeamsChat,
  MicrosoftTeamsMiscData,
} from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceProjectAuthTokenService from "../../../../../Server/Services/WorkspaceProjectAuthTokenService";
import {
  getMicrosoftTeamsActionType,
  MicrosoftTeamsPublicNoteApprovalActionType,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
import MicrosoftTeamsPublicNoteApprovalActions from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/PublicNoteApproval";
import MicrosoftTeamsUtil from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import { DRAWN_FOR_PROJECT_ID_FIELD } from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsCardProject";
import MicrosoftTeamsConnectPrompt from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsConnectPrompt";
import WorkspaceConnectCompletion, {
  WorkspaceConnectCompletionResult,
} from "../../../../../Server/Utils/Workspace/WorkspaceConnectCompletion";
import { WorkspacePendingActionKind } from "../../../../../Server/Utils/Workspace/WorkspaceConnectRequest";
import WorkspacePublicNoteApproval, {
  PUBLIC_NOTE_REJECT_REASON_FIELD,
  WorkspaceDirectMessage,
} from "../../../../../Server/Utils/Workspace/WorkspacePublicNoteApproval";
import WorkspacePublicNoteApprovalActions from "../../../../../Server/Utils/Workspace/WorkspacePublicNoteApprovalActions";
import WorkspaceActionAuthorization from "../../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH,
  PublicNoteApprovalGiven,
  PublicNoteApprovalMessages,
  PublicNoteApprovalStatus,
} from "../../../../../Types/StatusPage/PublicNoteApproval";
import { ConnectRequestOutcome } from "../../../../../Types/Workspace/ConnectCallback";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import { mdText } from "../../../../../Utils/Markdown/FeedMarkdown";
import {
  ALICE,
  BOB,
  CAROL,
  DAVE,
  EVE,
  INCIDENT_ID,
  NOTE_ID,
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
 * APPROVE AND REJECT IN MICROSOFT TEAMS (#6289): a public note's approval
 * card, in an approver's personal chat with the bot, pressed - through
 * MicrosoftTeamsPublicNoteApprovalActions, over the real engine and one
 * note in memory.
 *
 *  - The card's buttons carry Slack's ids, which are Teams' too, and the
 *    project the card was sent for.
 *  - Approve decides as the member, and is answered in the chat.
 *  - Reject answers with a card that asks why: required, counted as it is
 *    typed, and checked again when it is sent. A reason that cannot be
 *    sent keeps the card; one that is rejects the note and removes it.
 *  - Every refusal is the engine's words; a late press is news; two at
 *    once decide once; a value a client made up decides nothing.
 *  - An account not connected is asked to connect, and its Approve is
 *    decided once it is.
 */

type AnySpy = SpyInstance<(...args: Array<any>) => any>;

interface FakeTurn {
  turnContext: TurnContext;
  replies: Array<unknown>;
  deleted: Array<unknown>;
}

function createTurn(): FakeTurn {
  const replies: Array<unknown> = [];
  const deleted: Array<unknown> = [];

  return {
    replies,
    deleted,
    turnContext: {
      activity: {
        replyToId: "card-activity-1",
        from: {
          id: "29:member",
          name: "Bob Example",
          aadObjectId: "entra-bob",
        },
        conversation: { id: "a:personal-chat", conversationType: "personal" },
      },
      deleteActivity: jest.fn(async (id: unknown): Promise<void> => {
        deleted.push(id);
      }),
      sendActivity: jest.fn(async (reply: unknown): Promise<void> => {
        replies.push(reply);
      }),
    } as unknown as TurnContext,
  };
}

function card(reply: unknown): JSONObject {
  return (reply as { attachments: Array<JSONObject> }).attachments[0]![
    "content"
  ] as JSONObject;
}

function replyText(reply: unknown): string {
  return ((card(reply)["body"] as Array<JSONObject>) || [])
    .map((element: JSONObject): string => {
      return String(element["text"] || "");
    })
    .join("\n");
}

async function press(
  turn: FakeTurn,
  userId: string,
  actionType: MicrosoftTeamsPublicNoteApprovalActionType,
  actionValue: string,
  submitted: JSONObject = {},
  projectId: ObjectID = PROJECT_ID,
): Promise<void> {
  await MicrosoftTeamsPublicNoteApprovalActions.handle({
    actionType: actionType,
    actionValue: actionValue,
    value: { action: actionType, actionValue: actionValue, ...submitted },
    projectId: projectId,
    oneUptimeUserId: new ObjectID(userId),
    databaseProps: { userId: new ObjectID(userId), tenantId: projectId },
    turnContext: turn.turnContext,
  });
}

beforeEach(() => {
  startWorld();
});

afterEach(() => {
  restoreWorld();
});

describe("the card's buttons", () => {
  test("carry Slack's ids, which are Teams' own", () => {
    for (const actionType of Object.values(
      MicrosoftTeamsPublicNoteApprovalActionType,
    )) {
      expect(getMicrosoftTeamsActionType(actionType)).toBe(actionType);
      expect(
        MicrosoftTeamsPublicNoteApprovalActions.isPublicNoteApprovalAction(
          actionType,
        ),
      ).toBe(true);
    }

    expect(
      MicrosoftTeamsPublicNoteApprovalActions.isPublicNoteApprovalAction(
        "ViewApproveRemediation",
      ),
    ).toBe(false);
  });

  test("the message as a card: Approve as its positive action, Reject, and the link to the note", () => {
    const message: WorkspaceDirectMessage =
      WorkspacePublicNoteApproval.getAskMessage({
        recordLabel: "Incident INC-42",
        recordTitle: "Checkout is down",
        notesUrl: NOTES_URL,
        note: "We are looking into it.",
        isEdit: false,
        sentBy: "Alice",
        waitingFor: {
          position: {
            step: SUPPORT,
            number: 1,
            count: 2,
            isFinal: false,
            isAskedAgain: false,
          },
          approverNames: ["Bob", "Dave"],
        },
        value: {
          kind: "Incident" as never,
          projectId: PROJECT_ID,
          recordId: INCIDENT_ID,
          noteId: NOTE_ID,
          submittedAt: "2026-11-07T09:00:00.000Z",
          stepId: SUPPORT.id,
          isFinal: false,
          isEdit: false,
          textDigest: WorkspacePublicNoteApproval.getTextDigest(
            "We are looking into it.",
          ),
        },
      });

    const built: JSONObject =
      MicrosoftTeamsUtil.buildAdaptiveCardFromMessageBlocks({
        messageBlocks: message.messageBlocks,
      });
    const actions: Array<JSONObject> = built["actions"] as Array<JSONObject>;

    expect(actions[0]).toMatchObject({
      type: "Action.Submit",
      title: "Approve",
      style: "positive",
      data: { action: "ApprovePublicNote" },
    });
    expect(actions[1]).toMatchObject({
      type: "Action.Submit",
      title: "Reject",
      data: { action: "ViewRejectPublicNote" },
    });
    expect(actions[2]).toMatchObject({
      type: "Action.OpenUrl",
      title: "View in OneUptime",
      url: NOTES_URL,
    });
  });

  test("a direct message's card carries its project on each of its buttons", async () => {
    const auth: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
    auth.projectId = PROJECT_ID;
    auth.workspaceProjectId = "tenant-1";
    auth.miscData = {
      tenantId: "tenant-1",
      availableChats: {
        "a:personal": {
          id: "a:personal",
          name: "Bob",
          chatType: "personal",
          memberAadObjectIds: ["entra-bob"],
        } as unknown as MicrosoftTeamsChat,
      },
    } as unknown as MicrosoftTeamsMiscData;

    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(auth as never);
    const sent: AnySpy = jest
      .spyOn(MicrosoftTeamsUtil, "sendAdaptiveCardToChat")
      .mockResolvedValue(undefined as never) as AnySpy;

    await MicrosoftTeamsUtil.sendDirectMessageToUserAsBot({
      projectId: PROJECT_ID,
      workspaceUserId: "entra-bob",
      messageBlocks: [
        {
          _type: "WorkspacePayloadButtons",
          buttons: [
            {
              _type: "WorkspaceMessagePayloadButton",
              title: "Approve",
              value: encodedValue(),
              actionId: "ApprovePublicNote",
            },
          ],
        } as never,
      ],
    });

    const sentCard: JSONObject = (
      sent.mock.calls[0]![0] as {
        adaptiveCard: JSONObject;
      }
    ).adaptiveCard;

    expect(
      ((sentCard["actions"] as Array<JSONObject>)[0]!["data"] as JSONObject)[
        DRAWN_FOR_PROJECT_ID_FIELD
      ],
    ).toBe(PROJECT_ID.toString());
  });
});

describe("Approve", () => {
  test("approves the step as the member, and answers in the chat with the step and who is next", async () => {
    const turn: FakeTurn = createTurn();

    await press(
      turn,
      BOB,
      MicrosoftTeamsPublicNoteApprovalActionType.ApprovePublicNote,
      encodedValue(),
    );

    expect(
      storedRound().approvals.map((given: PublicNoteApprovalGiven): string => {
        return given.userId;
      }),
    ).toEqual([BOB]);
    expect(turn.replies).toHaveLength(1);
    expect(replyText(turn.replies[0])).toContain(
      `✅ You approved a **public note** on [Incident INC-42](${NOTES_URL}) for step 1 of 2 (Support). It waits for step 2 of 2 (Legal): Carol.`,
    );
    expect(turn.deleted).toEqual([]);
    expect(world.logged).toEqual(["approve_public_note"]);
  });

  test("on the last step: published, once", async () => {
    await press(
      createTurn(),
      BOB,
      MicrosoftTeamsPublicNoteApprovalActionType.ApprovePublicNote,
      encodedValue(),
    );
    const turn: FakeTurn = createTurn();

    await press(
      turn,
      CAROL,
      MicrosoftTeamsPublicNoteApprovalActionType.ApprovePublicNote,
      encodedValue(),
    );

    expect(world.stored.isPublished).toBe(true);
    expect(replyText(turn.replies[0])).toContain(
      "It is now published on status pages.",
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
    {
      who: "somebody whose access does not include the note",
      userId: DAVE,
      arrange: (): void => {
        world.readers.delete(DAVE);
      },
      told: `You do not have permission to approve this public note: ${WorkspaceActionAuthorization.getNotIncludedReason("incident public note")}`,
    },
    {
      who: "anybody, on a note deleted since",
      userId: BOB,
      arrange: (): void => {
        world.exists = false;
      },
      told: "This public note is no longer in OneUptime. It may have been deleted.",
    },
  ])(
    "$who is told why, and nothing is written",
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
      const turn: FakeTurn = createTurn();

      await press(
        turn,
        userId,
        MicrosoftTeamsPublicNoteApprovalActionType.ApprovePublicNote,
        encodedValue(),
      );

      // A refusal is text: its words, escaped as Markdown where they need it.
      expect(replyText(turn.replies[0])).toContain(mdText`${told}`.toString());
      expect(world.writes).toEqual([]);
      expect(world.logged).toEqual([]);
    },
  );

  test("approval switched off since, the note still waiting: decided, as the Dashboard decides it", async () => {
    world.isRequired = false;
    const turn: FakeTurn = createTurn();

    await press(
      turn,
      BOB,
      MicrosoftTeamsPublicNoteApprovalActionType.ApprovePublicNote,
      encodedValue(),
    );

    expect(
      storedRound().approvals.map((given: PublicNoteApprovalGiven): string => {
        return given.userId;
      }),
    ).toEqual([BOB]);
    expect(replyText(turn.replies[0])).toContain(
      "✅ You approved a **public note**",
    );
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
    const turn: FakeTurn = createTurn();

    await press(
      turn,
      BOB,
      MicrosoftTeamsPublicNoteApprovalActionType.ApprovePublicNote,
      value,
    );

    expect(replyText(turn.replies[0])).toContain(
      `This public note on [Incident INC-42](${NOTES_URL}) no longer waits for approval, so nothing was decided.`,
    );
    expect(world.writes).toEqual([]);
  });

  test("an approver of an earlier step is told they cannot approve this one", async () => {
    world.steps = [SUPPORT, { ...world.steps[1]!, userIds: [BOB, CAROL] }];
    await press(
      createTurn(),
      BOB,
      MicrosoftTeamsPublicNoteApprovalActionType.ApprovePublicNote,
      encodedValue(),
    );
    const turn: FakeTurn = createTurn();

    await press(
      turn,
      BOB,
      MicrosoftTeamsPublicNoteApprovalActionType.ApprovePublicNote,
      encodedValue(),
    );

    expect(replyText(turn.replies[0])).toContain(
      PublicNoteApprovalMessages.approvedEarlierStep,
    );
    expect(world.writes).toHaveLength(1);
  });

  test("two approvers at the same moment: one approves, the other is told what was decided", async () => {
    world.steps = [SUPPORT];
    const value: string = encodedValue();
    const asBothRead: typeof world.stored = { ...world.stored };
    const first: FakeTurn = createTurn();
    const second: FakeTurn = createTurn();

    await press(
      first,
      BOB,
      MicrosoftTeamsPublicNoteApprovalActionType.ApprovePublicNote,
      value,
    );
    world.readsAsOf = asBothRead;
    await press(
      second,
      DAVE,
      MicrosoftTeamsPublicNoteApprovalActionType.ApprovePublicNote,
      value,
    );

    expect(replyText(second.replies[0])).toMatch(
      /This public note on .+ was already approved by \*\*Bob\*\* at .+\. It is published on status pages\./,
    );
    expect(world.writes).toHaveLength(1);
    expect(world.published).toHaveLength(1);
  });
});

describe("a value a client made up decides nothing", () => {
  test.each([
    [
      "the note's id",
      (): string => {
        return NOTE_ID.toString();
      },
    ],
    [
      "a value with its signature changed",
      (): string => {
        return `${encodedValue().slice(0, -2)}zz`;
      },
    ],
    [
      "no value",
      (): string => {
        return "";
      },
    ],
  ])(
    "%s: told the button could not be verified",
    async (_label: string, actionValue: () => string) => {
      const turn: FakeTurn = createTurn();

      await press(
        turn,
        BOB,
        MicrosoftTeamsPublicNoteApprovalActionType.ApprovePublicNote,
        actionValue(),
      );

      expect(replyText(turn.replies[0])).toContain(
        WorkspacePublicNoteApprovalActions.getUnverifiedMessage(),
      );
      expect(world.writes).toEqual([]);
    },
  );

  test("a value signed for another project than the press was read in", async () => {
    const turn: FakeTurn = createTurn();

    await press(
      turn,
      BOB,
      MicrosoftTeamsPublicNoteApprovalActionType.ApprovePublicNote,
      encodedValue(),
      {},
      OTHER_PROJECT_ID,
    );

    expect(replyText(turn.replies[0])).toContain(
      WorkspacePublicNoteApprovalActions.getUnverifiedMessage(),
    );
    expect(world.writes).toEqual([]);
  });

  test("the same press delivered twice approves once", async () => {
    const value: string = encodedValue();
    const turn: FakeTurn = createTurn();

    await press(
      turn,
      BOB,
      MicrosoftTeamsPublicNoteApprovalActionType.ApprovePublicNote,
      value,
    );
    await press(
      turn,
      BOB,
      MicrosoftTeamsPublicNoteApprovalActionType.ApprovePublicNote,
      value,
    );

    expect(world.writes).toHaveLength(1);
    expect(replyText(turn.replies[1])).toContain(
      "was already approved for step 1 of 2 (Support) by **Bob**",
    );
  });
});

describe("Reject, and the card that asks why", () => {
  test("Reject answers with the card: the reason required and counted, its Reject carrying the value; nothing is decided", async () => {
    const value: string = encodedValue();
    const turn: FakeTurn = createTurn();

    await press(
      turn,
      BOB,
      MicrosoftTeamsPublicNoteApprovalActionType.ViewRejectPublicNote,
      value,
    );

    const reasonCard: JSONObject = card(turn.replies[0]);
    const body: Array<JSONObject> = reasonCard["body"] as Array<JSONObject>;

    expect(body[0]).toMatchObject({ text: "Reject this public note?" });
    expect(String(body[1]!["text"])).toContain(
      "Public note on **Incident INC-42** - Checkout is down",
    );
    expect(body[2]).toMatchObject({
      type: "Input.Text",
      id: PUBLIC_NOTE_REJECT_REASON_FIELD,
      label: "Why are you rejecting it?",
      isMultiline: true,
      isRequired: true,
      maxLength: PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH,
      errorMessage: PublicNoteApprovalMessages.reasonRequired,
    });
    expect(body[3]).toMatchObject({ text: "The author sees this." });
    expect(reasonCard["actions"]).toEqual([
      {
        type: "Action.Submit",
        title: "Reject",
        style: "destructive",
        data: {
          action:
            MicrosoftTeamsPublicNoteApprovalActionType.SubmitRejectPublicNote,
          actionValue: value,
        },
      },
    ]);
    expect(world.writes).toEqual([]);
  });

  test("the sender pressing Reject is told why, with no card", async () => {
    world.steps = [{ ...SUPPORT, userIds: [ALICE, BOB] }];
    const turn: FakeTurn = createTurn();

    await press(
      turn,
      ALICE,
      MicrosoftTeamsPublicNoteApprovalActionType.ViewRejectPublicNote,
      encodedValue(),
    );

    expect(replyText(turn.replies[0])).toContain(
      PublicNoteApprovalMessages.sentByYou,
    );
    expect(
      (card(turn.replies[0])["body"] as Array<JSONObject>).some(
        (element: JSONObject): boolean => {
          return element["type"] === "Input.Text";
        },
      ),
    ).toBe(false);
  });

  test.each([
    ["no reason", {}, PublicNoteApprovalMessages.reasonRequired],
    [
      "an empty reason",
      { reason: "  " },
      PublicNoteApprovalMessages.reasonRequired,
    ],
    [
      "a reason over the longest kept",
      { reason: "x".repeat(PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH + 1) },
      `A reason may have at most ${PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH} characters.`,
    ],
  ])(
    "%s, sent anyway: told why, the card kept, and nothing rejected",
    async (_label: string, submitted: JSONObject, told: string) => {
      const turn: FakeTurn = createTurn();

      await press(
        turn,
        BOB,
        MicrosoftTeamsPublicNoteApprovalActionType.SubmitRejectPublicNote,
        encodedValue(),
        submitted,
      );

      expect(replyText(turn.replies[0])).toContain(mdText`${told}`.toString());
      expect(turn.deleted).toEqual([]);
      expect(world.writes).toEqual([]);
    },
  );

  test("with a reason: rejected, answered, and the card removed", async () => {
    const turn: FakeTurn = createTurn();

    await press(
      turn,
      BOB,
      MicrosoftTeamsPublicNoteApprovalActionType.SubmitRejectPublicNote,
      encodedValue(),
      { reason: "Do not name the vendor." },
    );

    expect(world.stored.approvalStatus).toBe(PublicNoteApprovalStatus.Rejected);
    expect(storedRound().rejection?.reason).toBe("Do not name the vendor.");
    expect(replyText(turn.replies[0])).toContain(
      "↩️ You rejected a **public note** on",
    );
    expect(turn.deleted).toEqual(["card-activity-1"]);
    expect(world.logged).toEqual(["reject_public_note"]);
  });

  test("a note rejected a moment earlier by somebody else: news, and the card removed", async () => {
    const value: string = encodedValue();
    const asBothRead: typeof world.stored = { ...world.stored };

    await press(
      createTurn(),
      DAVE,
      MicrosoftTeamsPublicNoteApprovalActionType.SubmitRejectPublicNote,
      value,
      { reason: "Hold it." },
    );
    world.readsAsOf = asBothRead;
    const turn: FakeTurn = createTurn();
    await press(
      turn,
      BOB,
      MicrosoftTeamsPublicNoteApprovalActionType.SubmitRejectPublicNote,
      value,
      { reason: "Not yet." },
    );

    expect(replyText(turn.replies[0])).toContain(
      "was already rejected by **Dave**",
    );
    expect(turn.deleted).toEqual(["card-activity-1"]);
    expect(world.writes).toHaveLength(1);
  });
});

describe("a Teams account not connected yet", () => {
  test("Approve is decided for them once they connect; Reject is pressed again", () => {
    const value: string = encodedValue();

    expect(
      MicrosoftTeamsConnectPrompt.describe({
        actionType:
          MicrosoftTeamsPublicNoteApprovalActionType.ApprovePublicNote,
        actionValue: value,
      }),
    ).toMatchObject({
      purpose: "approve this public note",
      pendingAction: {
        kind: WorkspacePendingActionKind.ApprovePublicNote,
        eventId: INCIDENT_ID,
        publicNoteApproval: value,
      },
    });

    expect(
      MicrosoftTeamsConnectPrompt.describe({
        actionType:
          MicrosoftTeamsPublicNoteApprovalActionType.SubmitRejectPublicNote,
        actionValue: value,
      }),
    ).toEqual({
      purpose: "reject this public note",
      again: { kind: "Button", label: "Reject" },
    });
  });

  test("once connected, the Approve is decided as the member", async () => {
    const result: WorkspaceConnectCompletionResult =
      await WorkspaceConnectCompletion.complete({
        request: {
          workspaceType: WorkspaceType.MicrosoftTeams,
          projectId: PROJECT_ID,
          workspaceUserId: "entra-bob",
          purpose: "approve this public note",
          pendingAction: {
            kind: WorkspacePendingActionKind.ApprovePublicNote,
            eventType: "Incident" as never,
            eventId: INCIDENT_ID,
            publicNoteApproval: encodedValue(),
          },
          teams: {
            serviceUrl: "https://smba.trafficmanager.net/teams/",
            conversationId: "a:personal-chat",
          },
          expiresAt: new Date(Date.now() + 60000),
        },
        userId: new ObjectID(BOB),
      });

    expect(result.outcome).toBe(ConnectRequestOutcome.Done);
    expect(result.answer.markdown).toContain(
      "✅ **Your Microsoft Teams account is connected to OneUptime.** You approved a **public note**",
    );
    expect(
      storedRound().approvals.map((given: PublicNoteApprovalGiven): string => {
        return given.userId;
      }),
    ).toEqual([BOB]);
  });
});
