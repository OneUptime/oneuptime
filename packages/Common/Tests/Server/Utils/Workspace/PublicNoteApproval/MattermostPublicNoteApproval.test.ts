import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import WorkspaceProjectAuthTokenService from "../../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../../../Server/Services/WorkspaceUserAuthTokenService";
import MattermostUtil from "../../../../../Server/Utils/Workspace/Mattermost/Mattermost";
import MattermostActionContext from "../../../../../Server/Utils/Workspace/Mattermost/MattermostActionContext";
import MattermostActions, {
  MattermostDialogAnswer,
  MattermostPressAnswer,
} from "../../../../../Server/Utils/Workspace/Mattermost/MattermostActions";
import { isMattermostAction } from "../../../../../Server/Utils/Workspace/Mattermost/MattermostActionTypes";
import MattermostConnection from "../../../../../Server/Utils/Workspace/Mattermost/MattermostConnection";
import SlackActionType from "../../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import WorkspaceConnectRequest from "../../../../../Server/Utils/Workspace/WorkspaceConnectRequest";
import { PUBLIC_NOTE_REJECT_REASON_FIELD } from "../../../../../Server/Utils/Workspace/WorkspacePublicNoteApproval";
import WorkspacePublicNoteApprovalActions from "../../../../../Server/Utils/Workspace/WorkspacePublicNoteApprovalActions";
import WorkspaceActionAuthorization from "../../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import { JSONArray, JSONObject } from "../../../../../Types/JSON";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import {
  PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH,
  PublicNoteApprovalMessages,
  PublicNoteApprovalStatus,
} from "../../../../../Types/StatusPage/PublicNoteApproval";
import {
  WorkspaceModalBlock,
  WorkspacePayloadButtons,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import ObjectID from "../../../../../Types/ObjectID";
import { mdText } from "../../../../../Utils/Markdown/FeedMarkdown";
import {
  ALICE,
  BOB,
  CAROL,
  DAVE,
  EVE,
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
 * APPROVE AND REJECT IN MATTERMOST (#6289): a public note's approval
 * message, in an approver's direct message with the bot, pressed - through
 * MattermostActions, over the real engine and one note in memory.
 *
 *  - A direct message belongs to no team: Mattermost names none for its
 *    presses. Its buttons are signed for its channel, and a press is acted
 *    on only from that channel; a team's context still needs its team.
 *  - Approve decides as the member, answered only to them. Reject opens a
 *    dialog held to the same channel; a reason missing or too long keeps it
 *    open with why under the field; one that is not rejects the note, and
 *    what it came to is a post only the presser sees.
 *  - Every refusal is the engine's words; a late press is news; two at
 *    once decide once; a forged or replayed press decides nothing.
 *  - An account not connected is asked to connect, and to press again.
 */

type AnySpy = SpyInstance<(...args: Array<any>) => any>;

const TEAM_ID: string = "t".repeat(26);
const DIRECT_CHANNEL: string = "d".repeat(26);
const OTHER_CHANNEL: string = "x".repeat(26);
const BOT_USER_ID: string = "b".repeat(26);
const AUTH_TOKEN: string = MattermostConnection.toAuthToken({
  serverUrl: "https://chat.example.com",
  accessToken: "abcdefghijklmnopqrstuvwxyz",
  teamId: TEAM_ID,
  botUserId: BOT_USER_ID,
});

// The Mattermost account of each member, 26 letters.
function mattermostIdOf(userId: string): string {
  return userId.replace(/-/g, "").slice(0, 26).padEnd(26, "0");
}

let showModal: AnySpy;
let postEphemeral: AnySpy;
let findUserLink: AnySpy;

function pressBody(
  userId: string,
  actionId: string,
  value: string,
  overrides: JSONObject = {},
): JSONObject {
  return {
    user_id: mattermostIdOf(userId),
    // A press in a direct message names no team.
    team_id: "",
    channel_id: DIRECT_CHANNEL,
    post_id: "p".repeat(26),
    trigger_id: "trigger-1",
    context: MattermostActionContext.toContext({
      teamId: TEAM_ID,
      channelId: DIRECT_CHANNEL,
      actions: [{ actionId: actionId, value: value }],
    }),
    ...overrides,
  };
}

function rejectSubmission(
  userId: string,
  value: string,
  submission: JSONObject,
  overrides: JSONObject = {},
): JSONObject {
  return {
    type: "dialog_submission",
    callback_id: SlackActionType.SubmitRejectPublicNote,
    user_id: mattermostIdOf(userId),
    // A dialog's submission names the team its person is looking at.
    team_id: "o".repeat(26),
    channel_id: DIRECT_CHANNEL,
    state: MattermostActionContext.toDialogState({
      teamId: TEAM_ID,
      channelId: DIRECT_CHANNEL,
      actionId: SlackActionType.SubmitRejectPublicNote,
      value: value,
    }),
    submission: submission,
    cancelled: false,
    ...overrides,
  };
}

async function approve(
  userId: string,
  value: string = encodedValue(),
  overrides: JSONObject = {},
): Promise<MattermostPressAnswer> {
  return await MattermostActions.handlePress(
    pressBody(userId, SlackActionType.ApprovePublicNote, value, overrides),
  );
}

beforeEach(() => {
  startWorld();

  jest
    .spyOn(WorkspaceProjectAuthTokenService, "findOneBy")
    .mockResolvedValue({ authToken: AUTH_TOKEN } as never);
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "countBy")
    .mockResolvedValue(new PositiveNumber(1));
  findUserLink = jest
    .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
    .mockImplementation((async (find: {
      query: { workspaceUserId: string };
    }) => {
      const member: string | undefined = [ALICE, BOB, CAROL, DAVE, EVE].find(
        (userId: string): boolean => {
          return mattermostIdOf(userId) === find.query.workspaceUserId;
        },
      );

      return member ? { userId: new ObjectID(member) } : null;
    }) as never) as AnySpy;
  showModal = jest
    .spyOn(MattermostUtil, "showModalToUser")
    .mockResolvedValue(undefined as never) as AnySpy;
  postEphemeral = jest
    .spyOn(MattermostUtil, "postEphemeral")
    .mockResolvedValue(undefined as never) as AnySpy;
});

afterEach(() => {
  restoreWorld();
});

describe("the buttons of a direct message", () => {
  test("Approve and Reject are shown in Mattermost", () => {
    expect(isMattermostAction(SlackActionType.ApprovePublicNote)).toBe(true);
    expect(isMattermostAction(SlackActionType.ViewRejectPublicNote)).toBe(true);
  });

  test("a direct message's buttons are signed for its channel: pressed there they verify, from anywhere else they do not", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];

    jest.spyOn(MattermostUtil, "callServer").mockImplementation((async (data: {
      path: string;
      body: unknown;
    }) => {
      calls.push({ path: data.path, body: data.body });

      return data.path === "/api/v4/channels/direct"
        ? { id: DIRECT_CHANNEL }
        : { id: "p".repeat(26) };
    }) as never);

    const buttons: WorkspacePayloadButtons = {
      _type: "WorkspacePayloadButtons",
      buttons: [
        {
          _type: "WorkspaceMessagePayloadButton",
          title: "Approve",
          value: encodedValue(),
          actionId: SlackActionType.ApprovePublicNote,
          isPrimary: true,
        },
      ],
    };

    await MattermostUtil.sendDirectMessageToUser({
      authToken: AUTH_TOKEN,
      workspaceUserId: mattermostIdOf(BOB),
      messageBlocks: [buttons],
    });

    const post: JSONObject = calls.find((call) => {
      return call.path === "/api/v4/posts";
    })!.body as JSONObject;
    const context: unknown = (
      (
        ((post["props"] as JSONObject)["attachments"] as JSONArray)[0] as JSONObject
      )["actions"] as Array<JSONObject>
    )[0]!["integration"] as JSONObject;

    const signed: unknown = (context as JSONObject)["context"];

    expect(
      MattermostActionContext.readPress({
        context: signed,
        teamId: "",
        channelId: DIRECT_CHANNEL,
      })?.actionId,
    ).toBe(SlackActionType.ApprovePublicNote);
    // Pressed from another channel, or with the team named but not the channel.
    expect(
      MattermostActionContext.readPress({
        context: signed,
        teamId: "",
        channelId: OTHER_CHANNEL,
      }),
    ).toBeNull();
    expect(
      MattermostActionContext.readPress({ context: signed, teamId: TEAM_ID }),
    ).toBeNull();
  });
});

describe("Approve", () => {
  test("approves the step as the member, answered only to them", async () => {
    const answer: MattermostPressAnswer = await approve(BOB);

    expect(answer.ephemeral_text).toBe(
      `✅ You approved a **public note** on [Incident INC-42](${NOTES_URL}) for step 1 of 2 (Support). It waits for step 2 of 2 (Legal): Carol.`,
    );
    expect(storedRound().approvals.map((given) => given.userId)).toEqual([BOB]);
    expect(world.logged).toEqual(["approve_public_note"]);
  });

  test("on the last step: published, once", async () => {
    await approve(BOB);
    const answer: MattermostPressAnswer = await approve(CAROL);

    expect(answer.ephemeral_text).toContain(
      "It is now published on status pages.",
    );
    expect(world.stored.isPublished).toBe(true);
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
      who: "anybody, on a note deleted since",
      userId: BOB,
      arrange: (): void => {
        world.exists = false;
      },
      told: "This public note is no longer in OneUptime. It may have been deleted.",
    },
  ])("$who is told why, and nothing is written", async ({ userId, arrange, told }) => {
    arrange();

    const answer: MattermostPressAnswer = await approve(userId);

    // A refusal is text: its words, escaped as Markdown where they need it.
    expect(answer.ephemeral_text).toBe(mdText`${told}`.toString());
    expect(world.writes).toEqual([]);
  });

  test("an approver of an earlier step is told they cannot approve this one", async () => {
    world.steps = [SUPPORT, { ...world.steps[1]!, userIds: [BOB, CAROL] }];
    await approve(BOB);

    const answer: MattermostPressAnswer = await approve(BOB);

    expect(answer.ephemeral_text).toBe(
      PublicNoteApprovalMessages.approvedEarlierStep,
    );
    expect(world.writes).toHaveLength(1);
  });

  test("a member whose access does not include the note is told so", async () => {
    world.readers.delete(DAVE);

    const answer: MattermostPressAnswer = await approve(DAVE);

    expect(answer.ephemeral_text).toBe(
      `You do not have permission to approve this public note: ${WorkspaceActionAuthorization.getNotIncludedReason("incident public note")}`,
    );
    expect(world.writes).toEqual([]);
  });

  test("two approvers at the same moment: one approves, the other is told what was decided", async () => {
    world.steps = [SUPPORT];
    const value: string = encodedValue();
    const asBothRead: typeof world.stored = { ...world.stored };

    await approve(BOB, value);
    world.readsAsOf = asBothRead;
    const second: MattermostPressAnswer = await approve(DAVE, value);

    expect(second.ephemeral_text).toMatch(
      /^✅ This public note on .+ was already approved by \*\*Bob\*\* at .+\. It is published on status pages\.$/,
    );
    expect(world.writes).toHaveLength(1);
    expect(world.published).toHaveLength(1);
  });
});

describe("forged, replayed and stale presses", () => {
  test("a press of a direct message's button from another channel is refused before anything is read", async () => {
    const answer: MattermostPressAnswer = await approve(BOB, encodedValue(), {
      channel_id: OTHER_CHANNEL,
    });

    expect(answer.ephemeral_text).toBe(MattermostActions.UNVERIFIED_PRESS_MESSAGE);
    expect(findUserLink).not.toHaveBeenCalled();
    expect(world.writes).toEqual([]);
  });

  test("a context OneUptime did not sign is refused", async () => {
    const forged: JSONObject = pressBody(
      BOB,
      SlackActionType.ApprovePublicNote,
      encodedValue(),
    );
    (forged["context"] as JSONObject)["signature"] = "forged";

    const answer: MattermostPressAnswer = await MattermostActions.handlePress(forged);

    expect(answer.ephemeral_text).toBe(MattermostActions.UNVERIFIED_PRESS_MESSAGE);
    expect(world.writes).toEqual([]);
  });

  test("a signed context whose value is not an approval this installation signed decides nothing", async () => {
    const answer: MattermostPressAnswer = await approve(BOB, NOTE_ID.toString());

    expect(answer.ephemeral_text).toBe(
      WorkspacePublicNoteApprovalActions.getUnverifiedMessage(),
    );
    expect(world.writes).toEqual([]);
  });

  test("a value signed for a project this team is not connected to decides nothing", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findOneBy")
      .mockImplementation((async (find: { query: { projectId: ObjectID } }) => {
        return find.query.projectId.toString() === PROJECT_ID.toString()
          ? { authToken: AUTH_TOKEN }
          : null;
      }) as never);

    const answer: MattermostPressAnswer = await approve(
      BOB,
      encodedValue({ projectId: OTHER_PROJECT_ID }),
    );

    expect(answer.ephemeral_text).toBe(
      "This Mattermost team is no longer connected to the OneUptime project this message is from.",
    );
    expect(world.writes).toEqual([]);
  });

  test("the same press sent twice approves once", async () => {
    const value: string = encodedValue();

    await approve(BOB, value);
    const again: MattermostPressAnswer = await approve(BOB, value);

    expect(world.writes).toHaveLength(1);
    expect(again.ephemeral_text).toContain(
      "was already approved for step 1 of 2 (Support) by **Bob**",
    );
  });

  test("a press on a note that changed since is news", async () => {
    const value: string = encodedValue();
    world.stored = { ...world.stored, note: "Rewritten." };

    const answer: MattermostPressAnswer = await approve(BOB, value);

    expect(answer.ephemeral_text).toContain(
      "changed after you were asked about it, so nothing was decided.",
    );
    expect(world.writes).toEqual([]);
  });
});

describe("Reject, and its dialog", () => {
  test("Reject opens the dialog, held to the direct message it was pressed in; nothing is decided", async () => {
    const value: string = encodedValue();

    const answer: MattermostPressAnswer = await MattermostActions.handlePress(
      pressBody(BOB, SlackActionType.ViewRejectPublicNote, value),
    );

    expect(answer).toEqual({});
    expect(showModal).toHaveBeenCalledTimes(1);

    const shown: {
      modalBlock: WorkspaceModalBlock;
      directMessageChannelId?: string;
      triggerId: string;
    } = showModal.mock.calls[0]![0] as never;

    expect(shown.directMessageChannelId).toBe(DIRECT_CHANNEL);
    expect(shown.triggerId).toBe("trigger-1");
    expect(shown.modalBlock.actionId).toBe(
      SlackActionType.SubmitRejectPublicNote,
    );
    expect(shown.modalBlock.actionValue).toBe(value);

    // The dialog's state, as Mattermost hands it back: from the direct message only.
    const dialog: JSONObject = MattermostUtil.getDialog({
      modalBlock: shown.modalBlock,
      teamId: TEAM_ID,
      directMessageChannelId: shown.directMessageChannelId,
    });

    expect(
      MattermostActionContext.readDialogState({
        state: dialog["state"],
        teamId: "o".repeat(26),
        channelId: DIRECT_CHANNEL,
      })?.value,
    ).toBe(value);
    expect(
      MattermostActionContext.readDialogState({
        state: dialog["state"],
        teamId: TEAM_ID,
        channelId: OTHER_CHANNEL,
      }),
    ).toBeNull();
    expect(world.writes).toEqual([]);
  });

  test("the sender pressing Reject is told why, and no dialog opens", async () => {
    world.steps = [{ ...SUPPORT, userIds: [ALICE, BOB] }];

    const answer: MattermostPressAnswer = await MattermostActions.handlePress(
      pressBody(ALICE, SlackActionType.ViewRejectPublicNote, encodedValue()),
    );

    expect(answer.ephemeral_text).toBe(PublicNoteApprovalMessages.sentByYou);
    expect(showModal).not.toHaveBeenCalled();
  });

  test.each([
    ["no reason", {}, PublicNoteApprovalMessages.reasonRequired],
    ["an empty reason", { reason: " \n " }, PublicNoteApprovalMessages.reasonRequired],
    [
      "a reason over the longest kept",
      { reason: "x".repeat(PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH + 1) },
      `A reason may have at most ${PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH} characters.`,
    ],
  ])("%s keeps the dialog open, saying why under the field", async (_label: string, submission: JSONObject, told: string) => {
    const answer: MattermostDialogAnswer =
      await MattermostActions.handleDialogSubmission(
        rejectSubmission(BOB, encodedValue(), submission),
      );

    expect(answer).toEqual({ errors: { [PUBLIC_NOTE_REJECT_REASON_FIELD]: told } });
    expect(world.writes).toEqual([]);
    expect(postEphemeral).not.toHaveBeenCalled();
  });

  test("with a reason: the dialog closes, the note is rejected, and the presser is told in a post only they see", async () => {
    const answer: MattermostDialogAnswer =
      await MattermostActions.handleDialogSubmission(
        rejectSubmission(BOB, encodedValue(), {
          [PUBLIC_NOTE_REJECT_REASON_FIELD]: "Do not name the vendor.",
        }),
      );

    expect(answer).toEqual({});
    expect(world.stored.approvalStatus).toBe(PublicNoteApprovalStatus.Rejected);
    expect(storedRound().rejection?.reason).toBe("Do not name the vendor.");
    expect(postEphemeral).toHaveBeenCalledTimes(1);
    expect(postEphemeral.mock.calls[0]![0]).toMatchObject({
      userId: mattermostIdOf(BOB),
      channelId: DIRECT_CHANNEL,
      markdown: `↩️ You rejected a **public note** on [Incident INC-42](${NOTES_URL}). It is not published, and its author sees your reason.`,
    });
    expect(world.logged).toEqual(["reject_public_note"]);
  });

  test("a submission from another channel than the dialog's is refused", async () => {
    const answer: MattermostDialogAnswer =
      await MattermostActions.handleDialogSubmission(
        rejectSubmission(
          BOB,
          encodedValue(),
          { [PUBLIC_NOTE_REJECT_REASON_FIELD]: "No." },
          { channel_id: OTHER_CHANNEL },
        ),
      );

    expect(answer).toEqual({ error: MattermostActions.UNVERIFIED_PRESS_MESSAGE });
    expect(world.writes).toEqual([]);
  });

  test("somebody who rejected it a moment earlier is news to the one who submits after", async () => {
    const value: string = encodedValue();
    const asBothRead: typeof world.stored = { ...world.stored };

    await MattermostActions.handleDialogSubmission(
      rejectSubmission(DAVE, value, {
        [PUBLIC_NOTE_REJECT_REASON_FIELD]: "Hold it.",
      }),
    );
    world.readsAsOf = asBothRead;
    await MattermostActions.handleDialogSubmission(
      rejectSubmission(BOB, value, {
        [PUBLIC_NOTE_REJECT_REASON_FIELD]: "Not yet.",
      }),
    );

    expect(
      (postEphemeral.mock.calls[1]![0] as { markdown: string }).markdown,
    ).toContain("was already rejected by **Dave**");
    expect(world.writes).toHaveLength(1);
  });
});

describe("a Mattermost account not connected yet", () => {
  test("is asked to connect it, and to press the button again; nothing is decided", async () => {
    findUserLink.mockResolvedValue(null as never);
    jest
      .spyOn(WorkspaceConnectRequest, "getSettingsUrl")
      .mockRejectedValue(new Error("no address") as never);

    const answer: MattermostPressAnswer = await approve(BOB);

    expect(answer.ephemeral_text).toContain(
      "**Connect your Mattermost account to approve this public note.**",
    );
    expect(answer.ephemeral_text).toContain("press the button again");
    expect(world.writes).toEqual([]);
  });
});
