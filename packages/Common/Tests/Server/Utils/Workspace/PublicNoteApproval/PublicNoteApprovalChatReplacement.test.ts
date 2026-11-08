import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import IncidentPublicNote from "../../../../../Models/DatabaseModels/IncidentPublicNote";
import WorkspacePublicNoteApprovalMessage from "../../../../../Models/DatabaseModels/WorkspacePublicNoteApprovalMessage";
import WorkspacePublicNoteApprovalMessageService from "../../../../../Server/Services/WorkspacePublicNoteApprovalMessageService";
import DeleteBy from "../../../../../Server/Types/Database/DeleteBy";
import UpdateBy from "../../../../../Server/Types/Database/UpdateBy";
import logger from "../../../../../Server/Utils/Logger";
import PublicNoteApprovalEngine, {
  PublicNoteApprovalDelete,
  PublicNoteApprovalOutcome,
  PublicNoteApprovalUpdate,
  PublicNoteKind,
} from "../../../../../Server/Utils/Notes/PublicNoteApprovalEngine";
import { getViewInProductTitle } from "../../../../../Server/Utils/AutoRemediation/RemediationChatWords";
import { MattermostRequestError } from "../../../../../Server/Utils/Workspace/Mattermost/Mattermost";
import SlackActionType from "../../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import WorkspacePublicNoteApprovalActions, {
  PublicNoteApprovalPressAnswer,
  PublicNoteApprovalPressOutcome,
} from "../../../../../Server/Utils/Workspace/WorkspacePublicNoteApprovalActions";
import WorkspacePublicNoteApprovalMessages from "../../../../../Server/Utils/Workspace/WorkspacePublicNoteApprovalMessages";
import { PublicNoteApprovalButtonValue } from "../../../../../Server/Utils/Workspace/WorkspacePublicNoteApproval";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import BadRequestException from "../../../../../Types/Exception/BadRequestException";
import ObjectID from "../../../../../Types/ObjectID";
import PublicNoteApproval, {
  PublicNoteApprovalDecision,
  PublicNoteApprovalState,
  PublicNoteApprovalStatus,
} from "../../../../../Types/StatusPage/PublicNoteApproval";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import {
  ALICE,
  BOB,
  CAROL,
  CHATS,
  DAVE,
  INCIDENT_ID,
  NOTE_ID,
  NOTES_URL,
  OTHER_PROJECT_ID,
  PROJECT_ID,
  ReplacedMessage,
  StoredNote,
  SUPPORT,
  TEAMS_SERVICE_URL,
  WORKSPACES,
  buttonValue,
  connect,
  heldNote,
  host,
  keepCopies,
  keptCopies,
  memberProps,
  replacedCopies,
  replacedWith,
  restoreWorld,
  sentTo,
  settled,
  startWorld,
  storedRound,
  world,
} from "./PublicNoteApprovalChatWorld";

/*
 * ONCE A PUBLIC NOTE IS DECIDED, EVERY APPROVER'S COPY OF ITS APPROVAL
 * MESSAGE SAYS WHAT HAPPENED (#6317), IN SLACK, MICROSOFT TEAMS AND
 * MATTERMOST.
 *
 * Over the real engine, the real press logic and the real keeping and
 * replacing of copies (WorkspacePublicNoteApprovalMessages), with one note
 * in memory, its kept copies as the table holds them and each chat's edit
 * of a message recorded (PublicNoteApprovalChatWorld):
 *
 *  - every way a round ends replaces the copies that asked about it - its
 *    step approved, the note published, rejected, edited or sent again,
 *    published without approval, its edit withdrawn, the note deleted, on
 *    its own or with its incident - in the words a late press gets, with
 *    View in OneUptime and no Approve or Reject; the decider's own copy is
 *    one of them, beside the answer their press gets;
 *  - a copy that still asks - the next step's - is left as it is;
 *  - a copy that cannot be replaced is logged and skipped, and never holds
 *    back, or changes, the decision;
 *  - a copy is replaced only through its own project's connection to the
 *    workspace it was sent through;
 *  - no copy is kept past its round.
 */

type AnySpy = SpyInstance<(...args: Array<any>) => any>;

const RECORD_LINK: string = `[Incident INC-42](${NOTES_URL})`;

// "{{TIME(2026-11-08T10:42:00Z)}}", as each chat shows it in its reader's time.
function withoutTimes(text: string): string {
  return text.replace(/\{\{TIME\([^)]*\)\}\}/g, "{{TIME}}");
}

function onlyText(workspaceType?: WorkspaceType): string {
  const texts: Array<string> = replacedWith(workspaceType);

  expect(texts).toHaveLength(1);

  return withoutTimes(texts[0]!);
}

function copiesIn(workspaceType: WorkspaceType): Array<ReplacedMessage> {
  return world.replaced.filter((replaced: ReplacedMessage): boolean => {
    return replaced.workspaceType === workspaceType;
  });
}

// Every copy replaced has View in OneUptime - to `url` - and nothing else.
function expectOnlyViewInOneUptime(url: string | null = NOTES_URL): void {
  expect(world.replaced.length).toBeGreaterThan(0);

  for (const replaced of world.replaced) {
    expect(
      replaced.buttons.map((button: ReplacedMessage["buttons"][number]) => {
        return [button.title, button.actionId, button.url?.toString()];
      }),
    ).toEqual(
      url ? [[getViewInProductTitle(), SlackActionType.OpenInOneUptime, url]] : [],
    );

    for (const button of replaced.buttons) {
      expect([
        SlackActionType.ApprovePublicNote,
        SlackActionType.ViewRejectPublicNote,
        SlackActionType.SubmitRejectPublicNote,
      ]).not.toContain(button.actionId);
    }
  }
}

async function approve(
  userId: string,
  overrides: Partial<PublicNoteApprovalButtonValue> = {},
): Promise<PublicNoteApprovalPressAnswer> {
  const answer: PublicNoteApprovalPressAnswer =
    await WorkspacePublicNoteApprovalActions.approve({
      value: buttonValue(overrides),
      props: memberProps(userId),
    });

  await settled();

  return answer;
}

async function reject(
  userId: string,
  reason: string,
): Promise<PublicNoteApprovalPressAnswer> {
  const answer: PublicNoteApprovalPressAnswer =
    await WorkspacePublicNoteApprovalActions.reject({
      value: buttonValue(),
      props: memberProps(userId),
      reason: reason,
    });

  await settled();

  return answer;
}

/*
 * An edit of the note's text, as its service writes it: approval reads it
 * first (beforeUpdate), the database writes it - held to the version read,
 * when approval held it - and approval says what came of it (afterUpdate).
 */
async function editNote(text: string, editor: string = ALICE): Promise<void> {
  const updateBy: UpdateBy<IncidentPublicNote> = {
    query: { _id: NOTE_ID.toString() },
    data: { note: text },
    props: memberProps(editor),
  } as unknown as UpdateBy<IncidentPublicNote>;

  const update: PublicNoteApprovalUpdate =
    await PublicNoteApprovalEngine.beforeUpdate({
      host: host(),
      updateBy: updateBy,
    });

  const heldTo: unknown = (updateBy.query as Record<string, unknown>)[
    "version"
  ];
  const updatedNoteIds: Array<ObjectID> = [];

  if (heldTo === undefined || heldTo === world.stored.version) {
    world.stored = {
      ...world.stored,
      ...(updateBy.data as unknown as Partial<StoredNote>),
      version: world.stored.version + 1,
    };
    updatedNoteIds.push(NOTE_ID);
  }

  await PublicNoteApprovalEngine.afterUpdate({
    host: host(),
    update: PublicNoteApprovalEngine.getCarryForward(update)
      ?.publicNoteApproval,
    updatedNoteIds: updatedNoteIds,
    props: memberProps(editor),
  });

  await settled();
}

// The database deletes the note, and its kept copies with it (ON DELETE CASCADE).
function cascadeDeleteOfNote(): void {
  world.exists = false;
  world.kept = world.kept.filter(
    (kept: WorkspacePublicNoteApprovalMessage): boolean => {
      return kept.incidentPublicNoteId?.toString() !== NOTE_ID.toString();
    },
  );
}

// The note deleted through its service: its hooks around the delete.
async function deleteNote(): Promise<void> {
  const carried: PublicNoteApprovalDelete =
    await PublicNoteApprovalEngine.beforeDelete({
      host: host(),
      deleteBy: {
        query: { _id: NOTE_ID.toString() },
        props: { isRoot: true },
        limit: 1,
        skip: 0,
      } as unknown as DeleteBy<IncidentPublicNote>,
    });

  cascadeDeleteOfNote();

  PublicNoteApprovalEngine.afterDelete({
    delete: carried,
    deletedIds: [NOTE_ID],
  });

  await settled();
}

// The incident deleted: its notes go with it, and their copies with them.
async function deleteIncident(): Promise<void> {
  const carried: PublicNoteApprovalDelete =
    await PublicNoteApprovalEngine.beforeRecordsDelete({
      kind: PublicNoteKind.Incident,
      records: [{ id: INCIDENT_ID, projectId: PROJECT_ID }],
    });

  world.record = null;
  cascadeDeleteOfNote();

  PublicNoteApprovalEngine.afterRecordsDelete({
    delete: carried,
    deletedIds: [INCIDENT_ID],
  });

  await settled();
}

async function resubmit(by: string = ALICE): Promise<void> {
  await PublicNoteApprovalEngine.resubmit({
    host: host(),
    noteId: NOTE_ID,
    props: memberProps(by),
  });

  await settled();
}

async function discardEdit(by: string = ALICE): Promise<void> {
  await PublicNoteApprovalEngine.discardEdit({
    host: host(),
    noteId: NOTE_ID,
    props: memberProps(by),
  });

  await settled();
}

// A published note, and an edit of it waiting for its first step.
async function publishedWithEditWaiting(): Promise<void> {
  world.stored = heldNote({
    isPublished: true,
    approvalStatus: null,
    approval: null,
  });

  await editNote("We found the cause: a faulty deploy.");

  expect(PublicNoteApproval.getState(world.stored)).toBe(
    PublicNoteApprovalState.EditWaitingForApproval,
  );
}

let errorLog: AnySpy;

beforeEach(() => {
  startWorld();
  errorLog = jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  }) as AnySpy;
  jest.spyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(async () => {
  await restoreWorld();
});

describe.each(CHATS)("in %s, every way a round ends", (chat: WorkspaceType) => {
  test("approved for the next step: the step's copies - the decider's too - say so and who it waits for; the next step's copy still asks", async () => {
    await keepCopies([BOB, DAVE], [chat]);

    const pressed: PublicNoteApprovalPressAnswer = await approve(BOB);

    // The decider is answered as before.
    expect(pressed.outcome).toBe(PublicNoteApprovalPressOutcome.Decided);
    expect(pressed.answer.markdown).toBe(
      `✅ You approved a **public note** on ${RECORD_LINK} for step 1 of 2 (Support). It waits for step 2 of 2 (Legal): Carol.`,
    );

    // Their own copy, and the other approver's, say what happened.
    expect(replacedCopies()).toEqual([`Bob:${chat}`, `Dave:${chat}`]);
    expect(onlyText(chat)).toBe(
      `✅ This public note on ${RECORD_LINK} was approved for step 1 of 2 (Support) by **Bob** at {{TIME}}. It waits for step 2 of 2 (Legal): Carol.`,
    );
    expect(
      world.replaced.map((replaced: ReplacedMessage) => {
        return replaced.text;
      }),
    ).toEqual([
      "This public note was approved for this step",
      "This public note was approved for this step",
    ]);
    expectOnlyViewInOneUptime();
    expect(keptCopies()).toEqual([]);

    // Legal's copy, sent as its step began, asks still.
    await keepCopies([CAROL], [chat]);

    expect(keptCopies()).toEqual([`Carol:${chat}`]);
    expect(replacedCopies()).toEqual([`Bob:${chat}`, `Dave:${chat}`]);
  });

  test("approved and published: the last step's copies say it is published", async () => {
    await keepCopies([BOB, DAVE], [chat]);
    await approve(DAVE);
    world.replaced = [];

    await keepCopies([CAROL], [chat]);

    const pressed: PublicNoteApprovalPressAnswer = await approve(CAROL);

    expect(pressed.answer.markdown).toBe(
      `✅ You approved a **public note** on ${RECORD_LINK}. It is now published on status pages.`,
    );
    expect(world.stored.isPublished).toBe(true);
    expect(replacedCopies()).toEqual([`Carol:${chat}`]);
    expect(onlyText(chat)).toBe(
      `✅ This public note on ${RECORD_LINK} was approved by **Carol** at {{TIME}}. It is published on status pages.`,
    );
    expect(world.replaced[0]!.text).toBe("This public note was approved");
    expectOnlyViewInOneUptime();
    expect(keptCopies()).toEqual([]);
  });

  test("rejected: the copies say who rejected it, and the note is not published", async () => {
    await keepCopies([BOB, DAVE], [chat]);

    const pressed: PublicNoteApprovalPressAnswer = await reject(
      DAVE,
      "Do not name the vendor yet.",
    );

    expect(pressed.outcome).toBe(PublicNoteApprovalPressOutcome.Decided);
    expect(replacedCopies()).toEqual([`Bob:${chat}`, `Dave:${chat}`]);
    expect(onlyText(chat)).toBe(
      `↩️ This public note on ${RECORD_LINK} was rejected by **Dave** at {{TIME}}. It is not published.`,
    );
    expectOnlyViewInOneUptime();
    expect(keptCopies()).toEqual([]);
  });

  test("edited while it waits: a new round, and the copies say it changed and who it waits for now", async () => {
    await keepCopies([BOB, DAVE], [chat]);
    const asked: string = storedRound().submittedAt;

    await editNote("We found the cause: a faulty deploy.");

    expect(storedRound().submittedAt).not.toBe(asked);
    expect(replacedCopies()).toEqual([`Bob:${chat}`, `Dave:${chat}`]);
    expect(onlyText(chat)).toBe(
      `📝 This public note on ${RECORD_LINK} changed after you were asked about it. It waits for step 1 of 2 (Support): Bob, Dave.`,
    );
    expectOnlyViewInOneUptime();
    expect(keptCopies()).toEqual([]);
    // Its approvers are asked again, in a message of their own.
    expect(world.asked).toEqual([[BOB, DAVE]]);
  });

  test("rejected, then sent for approval again as it was: a copy of the rejected round sent late says it was sent again", async () => {
    const roundOne: PublicNoteApprovalButtonValue = buttonValue();

    await reject(DAVE, "Not yet.");
    await resubmit();

    expect(PublicNoteApproval.getState(world.stored)).toBe(
      PublicNoteApprovalState.WaitingForApproval,
    );

    await keepCopies([BOB], [chat], roundOne);

    expect(replacedCopies()).toEqual([`Bob:${chat}`]);
    expect(onlyText(chat)).toBe(
      `📝 This public note on ${RECORD_LINK} was sent for approval again after you were asked about it. It waits for step 1 of 2 (Support): Bob, Dave.`,
    );
    expect(keptCopies()).toEqual([]);
  });

  test("published without approval once approval was turned off", async () => {
    await keepCopies([BOB, DAVE], [chat]);
    world.isRequired = false;

    await resubmit();

    expect(world.stored.isPublished).toBe(true);
    expect(replacedCopies()).toEqual([`Bob:${chat}`, `Dave:${chat}`]);
    expect(onlyText(chat)).toBe(
      `📄 This public note on ${RECORD_LINK} was published without approval: public notes no longer need approval.`,
    );
    expectOnlyViewInOneUptime();
    expect(keptCopies()).toEqual([]);
  });

  test("deleted: the copies say so, and View in OneUptime opens the incident's notes", async () => {
    await keepCopies([BOB, DAVE], [chat]);

    await deleteNote();

    expect(replacedCopies()).toEqual([`Bob:${chat}`, `Dave:${chat}`]);
    expect(onlyText(chat)).toBe(
      `🗑️ This public note on ${RECORD_LINK} was deleted.`,
    );
    expect(world.replaced[0]!.text).toBe("This public note was deleted");
    expectOnlyViewInOneUptime();
    expect(keptCopies()).toEqual([]);
  });

  test("deleted with its incident: the copies say so, with nothing left to view", async () => {
    await keepCopies([BOB, DAVE], [chat]);

    await deleteIncident();

    expect(replacedCopies()).toEqual([`Bob:${chat}`, `Dave:${chat}`]);
    expect(onlyText(chat)).toBe("🗑️ This public note was deleted.");
    expectOnlyViewInOneUptime(null);
    expect(keptCopies()).toEqual([]);
  });

  test("an edit of a published note, approved on its last step: the copies say status pages show it", async () => {
    await publishedWithEditWaiting();
    await keepCopies([BOB, DAVE], [chat]);
    await approve(BOB);

    expect(onlyText(chat)).toBe(
      `✅ The edit of this public note on ${RECORD_LINK} was approved for step 1 of 2 (Support) by **Bob** at {{TIME}}. It waits for step 2 of 2 (Legal): Carol.`,
    );

    world.replaced = [];
    await keepCopies([CAROL], [chat]);
    await approve(CAROL);

    expect(world.stored.note).toBe("We found the cause: a faulty deploy.");
    expect(replacedCopies()).toEqual([`Carol:${chat}`]);
    expect(onlyText(chat)).toBe(
      `✅ The edit of this public note on ${RECORD_LINK} was approved by **Carol** at {{TIME}}. Status pages show the edited note.`,
    );
    expect(keptCopies()).toEqual([]);
  });

  test("an edit withdrawn by its author: the copies say it no longer waits", async () => {
    await publishedWithEditWaiting();
    await keepCopies([BOB, DAVE], [chat]);

    await discardEdit();

    expect(world.stored.pendingNote).toBeNull();
    expect(replacedCopies()).toEqual([`Bob:${chat}`, `Dave:${chat}`]);
    expect(onlyText(chat)).toBe(
      `The edit of this public note on ${RECORD_LINK} no longer waits for approval.`,
    );
    expect(keptCopies()).toEqual([]);
  });

  test("an edit edited back to the published text: the waiting edit is dropped, and its copies say so", async () => {
    await publishedWithEditWaiting();
    await keepCopies([BOB, DAVE], [chat]);

    await editNote(world.stored.note);

    expect(world.stored.pendingNote).toBeNull();
    expect(onlyText(chat)).toBe(
      `The edit of this public note on ${RECORD_LINK} no longer waits for approval.`,
    );
    expect(keptCopies()).toEqual([]);
  });

  test("an edit overtaken by another edit once approval was turned off: the waiting edit's copies say it no longer waits", async () => {
    await publishedWithEditWaiting();
    await keepCopies([BOB, DAVE], [chat]);
    world.isRequired = false;

    await editNote("An edit that applies as it is.");

    expect(world.stored.note).toBe("An edit that applies as it is.");
    expect(world.stored.pendingNote).toBeNull();
    expect(onlyText(chat)).toBe(
      `The edit of this public note on ${RECORD_LINK} no longer waits for approval.`,
    );
    expect(keptCopies()).toEqual([]);
  });

  test("a waiting edit published without approval once approval was turned off", async () => {
    await publishedWithEditWaiting();
    await keepCopies([BOB, DAVE], [chat]);
    world.isRequired = false;

    await resubmit();

    expect(world.stored.note).toBe("We found the cause: a faulty deploy.");
    expect(onlyText(chat)).toBe(
      `📄 The edit of this public note on ${RECORD_LINK} was published without approval: public notes no longer need approval.`,
    );
    expect(keptCopies()).toEqual([]);
  });

  test("an edit of the note that asks nothing new - its own text again - leaves the copies asking", async () => {
    await keepCopies([BOB, DAVE], [chat]);

    await editNote(world.stored.note);

    expect(world.replaced).toEqual([]);
    expect(keptCopies()).toEqual([`Bob:${chat}`, `Dave:${chat}`]);
  });

  test("each copy is replaced where it is, through the project's own connection to that chat", async () => {
    await keepCopies([BOB, DAVE], [chat]);
    await approve(BOB);

    for (const userId of [BOB, DAVE]) {
      const replaced: ReplacedMessage | undefined = copiesIn(chat).find(
        (candidate: ReplacedMessage): boolean => {
          return candidate.messageId === sentTo(userId, chat).messageId;
        },
      );

      expect(replaced?.authToken).toBe(
        `token-of-${PROJECT_ID.toString().slice(0, 8)}-${chat}`,
      );
      expect(replaced?.projectId).toBe(PROJECT_ID.toString());
      expect(replaced?.location).toEqual(
        chat === WorkspaceType.MicrosoftTeams
          ? {
              channelId: sentTo(userId, chat).channelId,
              isChat: true,
              serviceUrl: TEAMS_SERVICE_URL,
            }
          : { channelId: sentTo(userId, chat).channelId },
      );
    }
  });
});

describe("several approvers, in several chats", () => {
  test("every copy of every approver, in each chat they chose, says what happened - the decider's too", async () => {
    await keepCopies([BOB], [WorkspaceType.Slack, WorkspaceType.MicrosoftTeams]);
    await keepCopies([DAVE], [WorkspaceType.Mattermost, WorkspaceType.Slack]);

    await approve(DAVE);

    expect(replacedCopies()).toEqual([
      "Bob:MicrosoftTeams",
      "Bob:Slack",
      "Dave:Mattermost",
      "Dave:Slack",
    ]);

    for (const chat of CHATS) {
      expect(onlyText(chat)).toBe(
        `✅ This public note on ${RECORD_LINK} was approved for step 1 of 2 (Support) by **Dave** at {{TIME}}. It waits for step 2 of 2 (Legal): Carol.`,
      );
    }

    // Each through its own chat's connection.
    for (const replaced of world.replaced) {
      expect(replaced.authToken).toBe(
        `token-of-${PROJECT_ID.toString().slice(0, 8)}-${replaced.workspaceType}`,
      );
    }

    expect(keptCopies()).toEqual([]);
  });

  test("a step with many approvers: each copy is replaced once, one after another", async () => {
    const team: Array<string> = Array.from(
      { length: 12 },
      (_value: unknown, index: number): string => {
        return `aaaaaaaa-0000-4000-8000-${String(100 + index).padStart(12, "0")}`;
      },
    );

    await keepCopies([BOB, DAVE, ...team], CHATS);
    await approve(BOB);

    expect(world.replaced).toHaveLength((2 + team.length) * CHATS.length);
    expect(
      new Set(
        world.replaced.map((replaced: ReplacedMessage): string => {
          return `${replaced.workspaceType}:${replaced.messageId}`;
        }),
      ).size,
    ).toBe(world.replaced.length);
    expect(keptCopies()).toEqual([]);
  });
});

const GONE: Record<WorkspaceType, () => unknown> = {
  [WorkspaceType.Slack]: (): unknown => {
    return new BadRequestException("Error from Slack message_not_found");
  },
  [WorkspaceType.MicrosoftTeams]: (): unknown => {
    return Object.assign(new Error("Activity not found."), {
      statusCode: 404,
      code: "ActivityNotFoundInConversation",
    });
  },
  [WorkspaceType.Mattermost]: (): unknown => {
    return new MattermostRequestError({
      message: "Unable to get the post.",
      statusCode: 404,
      errorId: "app.post.get.app_error",
    });
  },
};

const REVOKED: Record<WorkspaceType, () => unknown> = {
  [WorkspaceType.Slack]: (): unknown => {
    return new BadRequestException("Error from Slack token_revoked");
  },
  [WorkspaceType.MicrosoftTeams]: (): unknown => {
    return Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  },
  [WorkspaceType.Mattermost]: (): unknown => {
    return new MattermostRequestError({
      message: "Invalid or expired session, please login again.",
      statusCode: 401,
      errorId: "api.context.session_expired.app_error",
    });
  },
};

const RATE_LIMITED: Record<WorkspaceType, () => unknown> = {
  [WorkspaceType.Slack]: (): unknown => {
    return new HTTPErrorResponse(429, { ok: false, error: "ratelimited" }, {});
  },
  [WorkspaceType.MicrosoftTeams]: (): unknown => {
    return Object.assign(new Error("Too Many Requests"), { statusCode: 429 });
  },
  [WorkspaceType.Mattermost]: (): unknown => {
    return new MattermostRequestError({
      message: "Too many requests. Please try again later.",
      statusCode: 429,
      errorId: "api.context.rate_limit",
    });
  },
};

describe.each(CHATS)(
  "in %s, a copy that cannot be replaced",
  (chat: WorkspaceType) => {
    const others: Array<WorkspaceType> = CHATS.filter(
      (workspaceType: WorkspaceType): boolean => {
        return workspaceType !== chat;
      },
    );

    test.each([
      ["deleted in the chat", GONE, "was deleted, so it was not replaced"],
      ["its token revoked", REVOKED, "Could not replace an approval message"],
      ["rate limited", RATE_LIMITED, "Could not replace an approval message"],
    ] as Array<[string, Record<WorkspaceType, () => unknown>, string]>)(
      "%s: logged and skipped - the decision stands, and every other copy is replaced",
      async (
        _what: string,
        errors: Record<WorkspaceType, () => unknown>,
        logged: string,
      ) => {
        world.editErrors[chat] = errors[chat]();
        await keepCopies([BOB, DAVE], CHATS);

        const pressed: PublicNoteApprovalPressAnswer = await approve(BOB);

        // The decision is made and told, as if nothing failed.
        expect(pressed.outcome).toBe(PublicNoteApprovalPressOutcome.Decided);
        expect(storedRound().approvals).toHaveLength(1);
        expect(world.asked).toEqual([[CAROL]]);

        // The chat was asked, refused, and that was logged.
        expect(
          world.editsAsked.filter(
            (asked: { workspaceType: WorkspaceType }): boolean => {
              return asked.workspaceType === chat;
            },
          ),
        ).toHaveLength(2);
        expect(copiesIn(chat)).toEqual([]);
        expect(
          errorLog.mock.calls.some((call: Array<any>): boolean => {
            return String(call[0]).includes(logged);
          }),
        ).toBe(true);

        // The others are replaced all the same.
        expect(replacedCopies()).toEqual(
          others
            .flatMap((workspaceType: WorkspaceType): Array<string> => {
              return [`Bob:${workspaceType}`, `Dave:${workspaceType}`];
            })
            .sort(),
        );

        // None is kept past its round, replaced or not.
        expect(keptCopies()).toEqual([]);
      },
    );

    test("the project no longer connected to the chat: not tried, dropped, and the others replaced", async () => {
      await keepCopies([BOB, DAVE], CHATS);
      connect(chat, null);

      await approve(BOB);

      expect(
        world.editsAsked.some(
          (asked: { workspaceType: WorkspaceType }): boolean => {
            return asked.workspaceType === chat;
          },
        ),
      ).toBe(false);
      expect(copiesIn(chat)).toEqual([]);
      expect(world.replaced).toHaveLength(2 * others.length);
      expect(keptCopies()).toEqual([]);
    });

    test("the project connected to another workspace of the chat since: that workspace's token never edits it", async () => {
      await keepCopies([BOB, DAVE], CHATS);
      connect(chat, `another-${WORKSPACES[chat]}`);

      await approve(BOB);

      expect(
        world.editsAsked.some(
          (asked: { workspaceType: WorkspaceType }): boolean => {
            return asked.workspaceType === chat;
          },
        ),
      ).toBe(false);
      expect(copiesIn(chat)).toEqual([]);
      expect(keptCopies()).toEqual([]);
    });

    test("one approver's copy refused, the next one's still replaced", async () => {
      await keepCopies([BOB, DAVE], [chat]);

      // The first edit asked of the chat is refused - rate limited - and the next one taken.
      let refusedOnce: boolean = false;

      Object.defineProperty(world.editErrors, chat, {
        configurable: true,
        enumerable: true,
        get: (): unknown => {
          if (refusedOnce) {
            return undefined;
          }

          refusedOnce = true;
          return RATE_LIMITED[chat]();
        },
      });

      await approve(BOB);

      expect(world.editsAsked).toHaveLength(2);
      expect(copiesIn(chat)).toHaveLength(1);
      expect(keptCopies()).toEqual([]);
    });
  },
);

describe("a copy of another project", () => {
  function keptForAnotherProject(): WorkspacePublicNoteApprovalMessage {
    const row: WorkspacePublicNoteApprovalMessage =
      new WorkspacePublicNoteApprovalMessage();
    row.id = ObjectID.generate();
    row.projectId = OTHER_PROJECT_ID;
    row.userId = new ObjectID(BOB);
    row.incidentPublicNoteId = NOTE_ID;
    row.recordId = INCIDENT_ID;
    row.workspaceType = WorkspaceType.Slack;
    row.workspaceProjectId = WORKSPACES[WorkspaceType.Slack];
    row.channelId = "D0OTHERPROJECT";
    row.messageId = "1700000000.other";
    row.submittedAt = buttonValue().submittedAt;
    row.stepId = SUPPORT.id;
    row.isFinal = false;
    row.isEdit = false;
    row.textDigest = buttonValue().textDigest;
    world.kept.push(row);
    return row;
  }

  test("is never read when this project's note is decided, and never edited with this project's token", async () => {
    keptForAnotherProject();
    connect(WorkspaceType.Slack, WORKSPACES[WorkspaceType.Slack], OTHER_PROJECT_ID);
    await keepCopies([DAVE], [WorkspaceType.Slack]);

    await approve(BOB);

    expect(replacedCopies()).toEqual(["Dave:Slack"]);
    expect(
      world.editsAsked.map((asked: { messageId: string }): string => {
        return asked.messageId;
      }),
    ).not.toContain("1700000000.other");
    expect(
      world.kept.map((kept: WorkspacePublicNoteApprovalMessage): string => {
        return kept.messageId!;
      }),
    ).toEqual(["1700000000.other"]);
  });

  test("is replaced, if ever, only through its own project's connection: never this project's", async () => {
    keptForAnotherProject();
    connect(WorkspaceType.Slack, WORKSPACES[WorkspaceType.Slack], OTHER_PROJECT_ID);

    await WorkspacePublicNoteApprovalMessages.replaceOver({
      kind: PublicNoteKind.Incident,
      projectId: OTHER_PROJECT_ID,
      noteId: NOTE_ID,
    });

    expect(world.replaced).toHaveLength(1);
    expect(world.replaced[0]!.authToken).toBe(
      `token-of-${OTHER_PROJECT_ID.toString().slice(0, 8)}-Slack`,
    );
    expect(world.replaced[0]!.projectId).toBe(OTHER_PROJECT_ID.toString());
    // This project's note is not that project's: there it is no more.
    expect(withoutTimes(world.replaced[0]!.markdown)).toBe(
      `🗑️ This public note on ${RECORD_LINK} was deleted.`,
    );
  });

  test("with no connection of its own, is dropped unedited", async () => {
    keptForAnotherProject();

    await WorkspacePublicNoteApprovalMessages.replaceOver({
      kind: PublicNoteKind.Incident,
      projectId: OTHER_PROJECT_ID,
      noteId: NOTE_ID,
    });

    expect(world.editsAsked).toEqual([]);
    expect(world.kept).toEqual([]);
  });
});

describe("never on the decision's way", () => {
  test("a chat that never answers: the press is decided and answered all the same", async () => {
    world.editsHang = true;
    await keepCopies([BOB, DAVE], CHATS);

    const pressed: PublicNoteApprovalPressAnswer =
      await WorkspacePublicNoteApprovalActions.approve({
        value: buttonValue(),
        props: memberProps(BOB),
      });

    expect(pressed.outcome).toBe(PublicNoteApprovalPressOutcome.Decided);
    expect(storedRound().approvals).toHaveLength(1);

    // The copies are still being replaced, behind it.
    expect(world.replaced).toEqual([]);
  });

  test("the kept copies cannot even be read: the Dashboard's decision is made and returned", async () => {
    await keepCopies([BOB, DAVE], CHATS);

    // The table does not answer until the decision is back.
    let isAnswering: boolean = false;
    const waiting: Array<() => void> = [];

    jest
      .spyOn(WorkspacePublicNoteApprovalMessageService, "findForNotes")
      .mockImplementation((async () => {
        if (!isAnswering) {
          await new Promise<void>((answer: () => void): void => {
            waiting.push(answer);
          });
        }

        return [];
      }) as never);

    const outcome: PublicNoteApprovalOutcome =
      await PublicNoteApprovalEngine.decide({
        host: host(),
        noteId: NOTE_ID,
        decision: PublicNoteApprovalDecision.Approve,
        props: memberProps(BOB),
      });

    expect(outcome.state).toBe(PublicNoteApprovalState.WaitingForApproval);
    expect(storedRound().approvals).toHaveLength(1);
    expect(world.replaced).toEqual([]);

    isAnswering = true;

    for (const answer of waiting.splice(0)) {
      answer();
    }
  });

  test("every chat refuses every edit: the decision stands, is announced and told, and nothing is kept", async () => {
    for (const chat of CHATS) {
      world.editErrors[chat] = REVOKED[chat]();
    }

    await keepCopies([BOB, DAVE], CHATS);

    const pressed: PublicNoteApprovalPressAnswer = await approve(BOB);

    expect(pressed.outcome).toBe(PublicNoteApprovalPressOutcome.Decided);
    expect(pressed.answer.markdown).toContain("You approved a **public note**");
    expect(world.feed.join("\n")).toContain("approved a **public note**");
    expect(world.asked).toEqual([[CAROL]]);
    expect(world.replaced).toEqual([]);
    expect(keptCopies()).toEqual([]);
  });

  test("a failure reading the note as the copies are replaced is logged, and leaves them for the next pass", async () => {
    await keepCopies([BOB, DAVE], [WorkspaceType.Slack]);
    jest
      .spyOn(WorkspacePublicNoteApprovalActions, "getReplacement")
      .mockRejectedValueOnce(new Error("The database went away.") as never);

    await approve(BOB);

    expect(world.replaced).toEqual([]);
    expect(keptCopies()).toEqual(["Bob:Slack", "Dave:Slack"]);
    expect(
      errorLog.mock.calls.some((call: Array<any>): boolean => {
        return String(call[0]).includes(
          "could not replace the chat messages of a public note",
        );
      }),
    ).toBe(true);

    // The next pass replaces them.
    await WorkspacePublicNoteApprovalMessages.replaceOver({
      kind: PublicNoteKind.Incident,
      projectId: PROJECT_ID,
      noteId: NOTE_ID,
    });

    expect(replacedCopies()).toEqual(["Bob:Slack", "Dave:Slack"]);
    expect(keptCopies()).toEqual([]);
  });
});

describe("a copy sent as the note moved on", () => {
  test.each(CHATS)(
    "in %s: kept after its step was approved, it is replaced at once",
    async (chat: WorkspaceType) => {
      const stepOne: PublicNoteApprovalButtonValue = buttonValue();

      await approve(BOB);
      expect(world.replaced).toEqual([]);

      // Dave's copy of step 1, on its way while Bob approved.
      await keepCopies([DAVE], [chat], stepOne);

      expect(replacedCopies()).toEqual([`Dave:${chat}`]);
      expect(onlyText(chat)).toBe(
        `✅ This public note on ${RECORD_LINK} was approved for step 1 of 2 (Support) by **Bob** at {{TIME}}. It waits for step 2 of 2 (Legal): Carol.`,
      );
      expect(keptCopies()).toEqual([]);
    },
  );

  test("kept after the note was deleted: dropped, since there is nothing to keep it for", async () => {
    const stepOne: PublicNoteApprovalButtonValue = buttonValue();

    await deleteNote();
    await keepCopies([DAVE], [WorkspaceType.Slack], stepOne);

    expect(onlyText(WorkspaceType.Slack)).toBe(
      `🗑️ This public note on ${RECORD_LINK} was deleted.`,
    );
    expect(keptCopies()).toEqual([]);
  });

  test("a copy that cannot say where it landed is not kept, and asks on", async () => {
    await WorkspacePublicNoteApprovalMessages.keep({
      value: buttonValue(),
      userId: new ObjectID(BOB),
      sent: sentTo(BOB, WorkspaceType.Slack, { messageId: "" }),
    });
    await WorkspacePublicNoteApprovalMessages.keep({
      value: buttonValue(),
      userId: new ObjectID(BOB),
      sent: sentTo(BOB, WorkspaceType.Slack, {
        channelId: "D".repeat(501),
      }),
    });

    expect(world.kept).toEqual([]);
  });

  test("a copy that cannot be kept - the table refuses it - is logged, and the send stands", async () => {
    jest
      .spyOn(WorkspacePublicNoteApprovalMessageService, "create")
      .mockRejectedValueOnce(new Error("The table is not there.") as never);

    await WorkspacePublicNoteApprovalMessages.keep({
      value: buttonValue(),
      userId: new ObjectID(BOB),
      sent: sentTo(BOB, WorkspaceType.Slack),
    });

    expect(world.kept).toEqual([]);
    expect(
      errorLog.mock.calls.some((call: Array<any>): boolean => {
        return String(call[0]).includes("could not keep it");
      }),
    ).toBe(true);
  });
});

describe("two passes at once", () => {
  test("each copy is replaced once: the pass that takes it out of the table replaces it", async () => {
    await keepCopies([BOB, DAVE], CHATS);

    await WorkspacePublicNoteApprovalActions.approve({
      value: buttonValue(),
      props: memberProps(BOB),
    });

    await Promise.all([
      WorkspacePublicNoteApprovalMessages.replaceOver({
        kind: PublicNoteKind.Incident,
        projectId: PROJECT_ID,
        noteId: NOTE_ID,
      }),
      WorkspacePublicNoteApprovalMessages.replaceOver({
        kind: PublicNoteKind.Incident,
        projectId: PROJECT_ID,
        noteId: NOTE_ID,
      }),
    ]);
    await settled();

    expect(world.replaced).toHaveLength(2 * CHATS.length);
    expect(replacedCopies()).toEqual(
      CHATS.flatMap((chat: WorkspaceType): Array<string> => {
        return [`Bob:${chat}`, `Dave:${chat}`];
      }).sort(),
    );
    expect(keptCopies()).toEqual([]);
  });

  test("two decisions a moment apart: the copies say what is true when they are replaced", async () => {
    await keepCopies([BOB, DAVE], [WorkspaceType.Slack]);

    // Both decided before any copy is replaced.
    await WorkspacePublicNoteApprovalActions.approve({
      value: buttonValue(),
      props: memberProps(BOB),
    });
    await WorkspacePublicNoteApprovalActions.approve({
      value: buttonValue(),
      props: memberProps(CAROL),
    });
    await settled();

    expect(world.stored.isPublished).toBe(true);
    expect(replacedCopies()).toEqual(["Bob:Slack", "Dave:Slack"]);

    for (const text of replacedWith(WorkspaceType.Slack)) {
      expect([
        `✅ This public note on ${RECORD_LINK} was approved by **Carol** at {{TIME}}. It is published on status pages.`,
        `✅ This public note on ${RECORD_LINK} was approved for step 1 of 2 (Support) by **Bob** at {{TIME}}. It waits for step 2 of 2 (Legal): Carol.`,
      ]).toContain(withoutTimes(text));
    }
  });
});

describe("a waiting note's copies, untouched while they still ask", () => {
  test("a pass with nothing over leaves every copy as it is", async () => {
    await keepCopies([BOB, DAVE], CHATS);

    expect(
      await WorkspacePublicNoteApprovalMessages.replaceOver({
        kind: PublicNoteKind.Incident,
        projectId: PROJECT_ID,
        noteId: NOTE_ID,
      }),
    ).toBe(0);
    expect(world.editsAsked).toEqual([]);
    expect(keptCopies()).toHaveLength(2 * CHATS.length);
  });

  test("its approval turned off, it still waits - and its copies still ask: a press there still decides", async () => {
    await keepCopies([BOB], [WorkspaceType.Slack]);
    world.isRequired = false;

    await WorkspacePublicNoteApprovalMessages.replaceOver({
      kind: PublicNoteKind.Incident,
      projectId: PROJECT_ID,
      noteId: NOTE_ID,
    });

    expect(world.replaced).toEqual([]);
    expect(world.stored.approvalStatus).toBe(
      PublicNoteApprovalStatus.WaitingForApproval,
    );
  });
});
