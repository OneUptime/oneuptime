import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import WorkspaceActionAuthorization from "../../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspacePublicNoteApproval, {
  PUBLIC_NOTE_APPROVAL_CHAT_WORDS,
  PUBLIC_NOTE_REJECT_REASON_FIELD,
  PublicNoteApprovalButtonValue,
} from "../../../../../Server/Utils/Workspace/WorkspacePublicNoteApproval";
import WorkspacePublicNoteApprovalActions, {
  PublicNoteApprovalPressAnswer,
  PublicNoteApprovalPressOutcome,
  PublicNoteRejectFormResult,
} from "../../../../../Server/Utils/Workspace/WorkspacePublicNoteApprovalActions";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import PublicNoteApproval, {
  PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH,
  PublicNoteApprovalMessages,
  PublicNoteApprovalStatus,
} from "../../../../../Types/StatusPage/PublicNoteApproval";
import {
  WorkspacePayloadMarkdown,
  WorkspaceTextAreaBlock,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import SlackActionType from "../../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import { getJestSpyOn } from "../../../../Spy";
import {
  ALICE,
  BOB,
  CAROL,
  DAVE,
  EVE,
  INCIDENT_ID,
  LEGAL,
  NOTE_ID,
  NOTE_TEXT,
  NOTES_URL,
  OTHER_PROJECT_ID,
  PROJECT_ID,
  SUPPORT,
  buttonValue,
  encodedValue,
  heldNote,
  memberProps,
  restoreWorld,
  startWorld,
  storedRound,
  world,
} from "./PublicNoteApprovalChatWorld";

/*
 * DECIDING ON A WAITING PUBLIC NOTE FROM CHAT (#6289), WHATEVER THE CHAT.
 *
 * WorkspacePublicNoteApprovalActions over the real engine and one note in
 * memory (PublicNoteApprovalChatWorld): a press decides with exactly the
 * Dashboard's rules, as the member who pressed, and only while the note is
 * what its message showed. Every refusal is the engine's own words; a
 * press that comes too late, or on a note that changed, decides nothing
 * and says what happened, as news; two approvers at once decide once.
 */

const RECORD_LINK: string = `[Incident INC-42](${NOTES_URL})`;

async function approve(
  userId: string,
  overrides: Partial<PublicNoteApprovalButtonValue> = {},
): Promise<PublicNoteApprovalPressAnswer> {
  return await WorkspacePublicNoteApprovalActions.approve({
    value: buttonValue(overrides),
    props: memberProps(userId),
  });
}

async function reject(
  userId: string,
  reason: unknown,
  overrides: Partial<PublicNoteApprovalButtonValue> = {},
): Promise<PublicNoteApprovalPressAnswer> {
  return await WorkspacePublicNoteApprovalActions.reject({
    value: buttonValue(overrides),
    props: memberProps(userId),
    reason: reason,
  });
}

beforeEach(() => {
  startWorld();
});

afterEach(() => {
  restoreWorld();
});

describe("Approve", () => {
  test("for the first of two steps: the note still waits, Legal is asked, and the approver is told the step and who is next", async () => {
    const pressed: PublicNoteApprovalPressAnswer = await approve(BOB);

    expect(pressed.outcome).toBe(PublicNoteApprovalPressOutcome.Decided);
    expect(pressed.answer.markdown).toBe(
      `✅ You approved a **public note** on ${RECORD_LINK} for step 1 of 2 (Support). It waits for step 2 of 2 (Legal): Carol.`,
    );
    expect(pressed.answer.text).toBe("You approved a public note for its step");

    expect(world.stored.isPublished).toBe(false);
    expect(
      storedRound().approvals.map(
        (given: { stepId: string; userId: string }) => {
          return [given.stepId, given.userId];
        },
      ),
    ).toEqual([[SUPPORT.id, BOB]]);
    expect(world.asked).toEqual([[CAROL]]);
    expect(world.published).toEqual([]);
    expect(world.workflows).toEqual([]);
    // The incident's feed says so, as for an approval from the Dashboard.
    expect(world.feed[0]).toContain(
      "approved a **public note** on [Incident INC-42](https://oneuptime.example/dashboard/p/incidents/i) for step 1 of 2 (Support).",
    );
  });

  test("for the last step: published once - its entry, its workflows, its sender told - and said so", async () => {
    await approve(BOB);

    const pressed: PublicNoteApprovalPressAnswer = await approve(CAROL);

    expect(pressed.outcome).toBe(PublicNoteApprovalPressOutcome.Decided);
    expect(pressed.answer.markdown).toBe(
      `✅ You approved a **public note** on ${RECORD_LINK}. It is now published on status pages.`,
    );
    expect(world.stored.isPublished).toBe(true);
    expect(world.stored.approvalStatus).toBe(PublicNoteApprovalStatus.Approved);
    expect(world.published).toEqual([
      { noteId: NOTE_ID.toString(), approvedByNames: ["Bob", "Carol"] },
    ]);
    expect(world.workflows).toEqual([`on-create:${NOTE_ID.toString()}`]);
    expect(world.told).toEqual([{ userId: ALICE, isApproved: true }]);
  });

  test("an edit of a published note, approved on its last step: status pages show the edit", async () => {
    world.steps = [SUPPORT];
    world.stored = heldNote({
      isPublished: true,
      note: "As approved.",
      pendingNote: "The edit.",
      approvalStatus: PublicNoteApprovalStatus.WaitingForApproval,
      approval: PublicNoteApproval.toJSON(
        PublicNoteApproval.startRound({
          now: new Date("2026-11-07T10:00:00.000Z"),
          submittedByUserId: ALICE,
          isEdit: true,
        }),
      ),
    });

    const pressed: PublicNoteApprovalPressAnswer = await approve(BOB);

    expect(pressed.outcome).toBe(PublicNoteApprovalPressOutcome.Decided);
    expect(pressed.answer.markdown).toBe(
      `✅ You approved the edit of a **public note** on ${RECORD_LINK}. Status pages now show the edited note.`,
    );
    expect(world.stored.note).toBe("The edit.");
    expect(world.stored.pendingNote).toBeNull();
  });

  test("approval switched off since, the note still waiting: decided as the Dashboard decides it", async () => {
    world.isRequired = false;

    const pressed: PublicNoteApprovalPressAnswer = await approve(BOB);

    expect(pressed.outcome).toBe(PublicNoteApprovalPressOutcome.Decided);
    expect(storedRound().approvals).toHaveLength(1);
  });
});

describe("Reject", () => {
  test("with a reason: rejected, its author told, and the approver told it is not published", async () => {
    const pressed: PublicNoteApprovalPressAnswer = await reject(
      BOB,
      "  Please do not name the vendor.  ",
    );

    expect(pressed.outcome).toBe(PublicNoteApprovalPressOutcome.Decided);
    expect(pressed.answer.markdown).toBe(
      `↩️ You rejected a **public note** on ${RECORD_LINK}. It is not published, and its author sees your reason.`,
    );
    expect(world.stored.approvalStatus).toBe(PublicNoteApprovalStatus.Rejected);
    expect(storedRound().rejection?.reason).toBe(
      "Please do not name the vendor.",
    );
    expect(storedRound().rejection?.userId).toBe(BOB);
    expect(world.told).toEqual([{ userId: ALICE, isApproved: false }]);
    expect(world.published).toEqual([]);
  });

  test("an edit, rejected: status pages keep the note as it was approved", async () => {
    world.stored = heldNote({
      isPublished: true,
      note: "As approved.",
      pendingNote: "The edit.",
      approval: PublicNoteApproval.toJSON(
        PublicNoteApproval.startRound({
          now: new Date("2026-11-07T10:00:00.000Z"),
          submittedByUserId: ALICE,
          isEdit: true,
        }),
      ),
    });

    const pressed: PublicNoteApprovalPressAnswer = await reject(BOB, "No.");

    expect(pressed.answer.markdown).toBe(
      `↩️ You rejected the edit of a **public note** on ${RECORD_LINK}. Status pages keep showing the note as it was approved, and its author sees your reason.`,
    );
    expect(world.stored.note).toBe("As approved.");
  });

  test.each([
    ["no reason at all", undefined],
    ["an empty reason", ""],
    ["only spaces and line breaks", "  \n\t  "],
    ["a number", 42],
    ["a list", ["why"]],
    ["an object", { reason: "why" }],
  ])(
    "%s cannot be sent: the engine's words, and nothing is written",
    async (_label: string, reason: unknown) => {
      const pressed: PublicNoteApprovalPressAnswer = await reject(BOB, reason);

      expect(pressed.outcome).toBe(PublicNoteApprovalPressOutcome.Refused);
      expect(pressed.answer.text).toBe(
        PublicNoteApprovalMessages.reasonRequired,
      );
      expect(world.writes).toEqual([]);
      expect(world.told).toEqual([]);
    },
  );

  test("a reason over the longest one kept cannot be sent; one exactly that long can", async () => {
    const tooLong: PublicNoteApprovalPressAnswer = await reject(
      BOB,
      "x".repeat(PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH + 1),
    );

    expect(tooLong.outcome).toBe(PublicNoteApprovalPressOutcome.Refused);
    expect(tooLong.answer.text).toBe(
      `A reason may have at most ${PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH} characters.`,
    );
    expect(world.writes).toEqual([]);

    const longest: PublicNoteApprovalPressAnswer = await reject(
      BOB,
      "y".repeat(PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH),
    );

    expect(longest.outcome).toBe(PublicNoteApprovalPressOutcome.Decided);
    expect(storedRound().rejection?.reason).toHaveLength(
      PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH,
    );
  });

  test("getReasonError: what a form's submission is told", () => {
    expect(
      WorkspacePublicNoteApprovalActions.getReasonError("Fine"),
    ).toBeNull();
    expect(WorkspacePublicNoteApprovalActions.getReasonError(" ")).toBe(
      PublicNoteApprovalMessages.reasonRequired,
    );
    expect(
      WorkspacePublicNoteApprovalActions.getReasonError(
        ` ${"z".repeat(PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH)} `,
      ),
    ).toBeNull();
    expect(
      WorkspacePublicNoteApprovalActions.getReasonError(
        "z".repeat(PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH + 1),
      ),
    ).toBe(PUBLIC_NOTE_APPROVAL_CHAT_WORDS.reasonTooLong);
  });
});

describe("refusals, in the engine's own words", () => {
  test("the person who sent it", async () => {
    world.steps = [{ ...SUPPORT, userIds: [ALICE, BOB] }, LEGAL];

    for (const pressed of [await approve(ALICE), await reject(ALICE, "No.")]) {
      expect(pressed.outcome).toBe(PublicNoteApprovalPressOutcome.Refused);
      expect(pressed.answer.text).toBe(PublicNoteApprovalMessages.sentByYou);
    }

    expect(world.writes).toEqual([]);
  });

  test("somebody the step does not name", async () => {
    const pressed: PublicNoteApprovalPressAnswer = await approve(EVE);

    expect(pressed.outcome).toBe(PublicNoteApprovalPressOutcome.Refused);
    expect(pressed.answer.text).toBe(
      PublicNoteApprovalMessages.notAnApprover('step 1 ("Support")'),
    );
    expect(world.writes).toEqual([]);
  });

  test("somebody named through a team they are on now may decide; off the team, they may not", async () => {
    world.steps = [{ ...SUPPORT, userIds: [], teamIds: ["team-1"] }, LEGAL];
    world.teams = { "team-1": [EVE] };

    expect((await approve(EVE)).outcome).toBe(
      PublicNoteApprovalPressOutcome.Decided,
    );

    startWorld();
    world.steps = [{ ...SUPPORT, userIds: [], teamIds: ["team-1"] }, LEGAL];
    world.teams = { "team-1": [] };

    expect((await approve(EVE)).answer.text).toBe(
      PublicNoteApprovalMessages.notAnApprover('step 1 ("Support")'),
    );
  });

  test("somebody who approved an earlier step may not approve this one, but may reject it", async () => {
    world.steps = [SUPPORT, { ...LEGAL, userIds: [BOB, CAROL] }];
    await approve(BOB);

    const approval: PublicNoteApprovalPressAnswer = await approve(BOB);

    expect(approval.outcome).toBe(PublicNoteApprovalPressOutcome.Refused);
    expect(approval.answer.text).toBe(
      PublicNoteApprovalMessages.approvedEarlierStep,
    );
    expect(world.writes).toHaveLength(1);

    const rejection: PublicNoteApprovalPressAnswer = await reject(
      BOB,
      "Second thoughts.",
    );

    expect(rejection.outcome).toBe(PublicNoteApprovalPressOutcome.Decided);
  });

  test("somebody whose access does not include the note is told so, never that it is not there", async () => {
    world.readers.delete(EVE);
    world.steps = [{ ...SUPPORT, userIds: [EVE] }];

    const pressed: PublicNoteApprovalPressAnswer = await approve(EVE);

    expect(pressed.outcome).toBe(PublicNoteApprovalPressOutcome.Refused);
    expect(pressed.answer.text).toBe(
      `You do not have permission to approve this public note: ${WorkspaceActionAuthorization.getNotIncludedReason("incident public note")}`,
    );
    expect(world.writes).toEqual([]);
  });

  test("somebody whose role may not read public notes is told which permission they lack", async () => {
    world.forbidden.add(BOB);

    const pressed: PublicNoteApprovalPressAnswer = await reject(BOB, "No.");

    expect(pressed.outcome).toBe(PublicNoteApprovalPressOutcome.Refused);
    expect(pressed.answer.text).toBe(
      "You do not have permission to reject this public note. You do not have Read Incident Public Note permission.",
    );
    expect(world.writes).toEqual([]);
  });

  test("a note deleted since is told as news", async () => {
    world.exists = false;

    for (const pressed of [await approve(BOB), await reject(BOB, "No.")]) {
      expect(pressed.outcome).toBe(PublicNoteApprovalPressOutcome.News);
      expect(pressed.answer.text).toBe(
        "This public note is no longer in OneUptime. It may have been deleted.",
      );
    }

    expect(world.writes).toEqual([]);
  });

  test("a step nobody is on any more decides nothing", async () => {
    world.steps = [];

    const pressed: PublicNoteApprovalPressAnswer = await approve(BOB);

    expect(pressed.outcome).toBe(PublicNoteApprovalPressOutcome.News);
    expect(pressed.answer.markdown).toContain(
      "changed after you were asked about it, so nothing was decided.",
    );
    expect(world.writes).toEqual([]);
  });
});

describe("pressed too late: news, never an error", () => {
  test("already approved and published by somebody else: who, and when", async () => {
    world.steps = [SUPPORT];
    await approve(DAVE);

    const pressed: PublicNoteApprovalPressAnswer = await approve(BOB, {
      stepId: SUPPORT.id,
      isFinal: true,
      submittedAt: storedRound().submittedAt,
    });

    expect(pressed.outcome).toBe(PublicNoteApprovalPressOutcome.News);
    expect(pressed.answer.markdown).toMatch(
      /^✅ This public note on \[Incident INC-42\]\([^)]+\) was already approved by \*\*Dave\*\* at \{\{TIME\(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\)\}\}\. It is published on status pages\.$/,
    );
    expect(world.writes).toHaveLength(1);
    expect(world.published).toHaveLength(1);
  });

  test("already rejected by somebody else", async () => {
    const value: PublicNoteApprovalButtonValue = buttonValue();
    await reject(DAVE, "Not yet.");

    const pressed: PublicNoteApprovalPressAnswer =
      await WorkspacePublicNoteApprovalActions.approve({
        value: value,
        props: memberProps(BOB),
      });

    expect(pressed.outcome).toBe(PublicNoteApprovalPressOutcome.News);
    expect(pressed.answer.markdown).toMatch(
      /^↩️ This public note on \[Incident INC-42\]\([^)]+\) was already rejected by \*\*Dave\*\* at \{\{TIME\([^)]+\)\}\}\. It is not published\.$/,
    );
    expect(world.writes).toHaveLength(1);
  });

  test("its step approved by somebody else: who, when, and who it waits for now", async () => {
    const value: PublicNoteApprovalButtonValue = buttonValue();
    await approve(DAVE);

    const pressed: PublicNoteApprovalPressAnswer =
      await WorkspacePublicNoteApprovalActions.approve({
        value: value,
        props: memberProps(BOB),
      });

    expect(pressed.outcome).toBe(PublicNoteApprovalPressOutcome.News);
    expect(pressed.answer.markdown).toMatch(
      /^✅ This public note on \[Incident INC-42\]\([^)]+\) was already approved for step 1 of 2 \(Support\) by \*\*Dave\*\* at \{\{TIME\([^)]+\)\}\}\. It waits for step 2 of 2 \(Legal\): Carol\.$/,
    );
    // Bob is not on Legal: nothing more was written for him.
    expect(world.writes).toHaveLength(1);
  });

  test("published without approval once approval was switched off", async () => {
    const value: PublicNoteApprovalButtonValue = buttonValue();
    world.stored = {
      ...world.stored,
      isPublished: true,
      approvalStatus: null,
      approval: null,
    };

    const pressed: PublicNoteApprovalPressAnswer =
      await WorkspacePublicNoteApprovalActions.approve({
        value: value,
        props: memberProps(BOB),
      });

    expect(pressed.outcome).toBe(PublicNoteApprovalPressOutcome.News);
    expect(pressed.answer.markdown).toBe(
      `This public note on ${RECORD_LINK} no longer waits for approval, so nothing was decided.`,
    );
    expect(world.writes).toEqual([]);
  });

  test("edited since: the new words are not approved by a press on the old ones", async () => {
    const value: PublicNoteApprovalButtonValue = buttonValue();
    world.stored = heldNote({
      note: "Different words entirely.",
      approval: PublicNoteApproval.toJSON(
        PublicNoteApproval.startRound({
          now: new Date("2026-11-07T09:30:00.000Z"),
          submittedByUserId: ALICE,
          isEdit: false,
        }),
      ),
    });

    const pressed: PublicNoteApprovalPressAnswer =
      await WorkspacePublicNoteApprovalActions.approve({
        value: value,
        props: memberProps(BOB),
      });

    expect(pressed.outcome).toBe(PublicNoteApprovalPressOutcome.News);
    expect(pressed.answer.markdown).toBe(
      `📝 This public note on ${RECORD_LINK} changed after you were asked about it, so nothing was decided. Read it as it is now in OneUptime before you decide.`,
    );
    expect(world.writes).toEqual([]);
  });

  test("sent for approval again with the same words: a new round, decided only from its own message", async () => {
    const value: PublicNoteApprovalButtonValue = buttonValue();
    world.stored = heldNote({
      approval: PublicNoteApproval.toJSON(
        PublicNoteApproval.startRound({
          now: new Date("2026-11-07T09:30:00.000Z"),
          submittedByUserId: ALICE,
          isEdit: false,
        }),
      ),
    });

    const pressed: PublicNoteApprovalPressAnswer =
      await WorkspacePublicNoteApprovalActions.approve({
        value: value,
        props: memberProps(BOB),
      });

    expect(pressed.outcome).toBe(PublicNoteApprovalPressOutcome.News);
    expect(pressed.answer.markdown).toBe(
      `📝 This public note on ${RECORD_LINK} was sent for approval again after you were asked about it, so nothing was decided. Read it as it is now in OneUptime before you decide.`,
    );

    // Its own message - the round as it is now - decides it.
    expect((await approve(BOB)).outcome).toBe(
      PublicNoteApprovalPressOutcome.Decided,
    );
  });

  test("words changed within the same round are not approved either", async () => {
    const value: PublicNoteApprovalButtonValue = buttonValue();
    world.stored = { ...world.stored, note: `${NOTE_TEXT} (changed)` };

    const pressed: PublicNoteApprovalPressAnswer =
      await WorkspacePublicNoteApprovalActions.approve({
        value: value,
        props: memberProps(BOB),
      });

    expect(pressed.outcome).toBe(PublicNoteApprovalPressOutcome.News);
    expect(pressed.answer.markdown).toContain(
      "changed after you were asked about it, so nothing was decided.",
    );
    expect(world.writes).toEqual([]);
  });

  test("a message that said the note waits for another step never publishes it: its steps changed, nothing is decided", async () => {
    // Asked about Support, step 1 of 2: approving it would not publish.
    const value: PublicNoteApprovalButtonValue = buttonValue();
    expect(value.isFinal).toBe(false);

    // Legal is taken out: approving Support now would publish.
    world.steps = [SUPPORT];

    const pressed: PublicNoteApprovalPressAnswer =
      await WorkspacePublicNoteApprovalActions.approve({
        value: value,
        props: memberProps(BOB),
      });

    expect(pressed.outcome).toBe(PublicNoteApprovalPressOutcome.News);
    expect(pressed.answer.markdown).toBe(
      `The approval steps of this public note on ${RECORD_LINK} changed after you were asked about it, so nothing was decided. It waits for Support: Bob, Dave.`,
    );
    expect(world.stored.isPublished).toBe(false);
    expect(world.writes).toEqual([]);
  });

  test("a step taken out: the press on its message decides nothing, and says who it waits for", async () => {
    const value: PublicNoteApprovalButtonValue = buttonValue();
    world.steps = [{ ...LEGAL, order: 1 }];

    const pressed: PublicNoteApprovalPressAnswer =
      await WorkspacePublicNoteApprovalActions.approve({
        value: value,
        props: memberProps(CAROL),
      });

    expect(pressed.outcome).toBe(PublicNoteApprovalPressOutcome.News);
    expect(pressed.answer.markdown).toBe(
      `The approval steps of this public note on ${RECORD_LINK} changed after you were asked about it, so nothing was decided. It waits for Legal: Carol.`,
    );
    expect(world.writes).toEqual([]);
  });
});

describe("two approvers at the same moment", () => {
  test("both read it before either wrote: the second is told what the first decided, and it is published once", async () => {
    world.steps = [SUPPORT];
    const asBothRead: typeof world.stored = { ...world.stored };
    const value: PublicNoteApprovalButtonValue = buttonValue();

    const first: PublicNoteApprovalPressAnswer =
      await WorkspacePublicNoteApprovalActions.approve({
        value: value,
        props: memberProps(BOB),
      });

    // Dave's press read the note as it was before Bob's write landed.
    world.readsAsOf = asBothRead;

    const second: PublicNoteApprovalPressAnswer =
      await WorkspacePublicNoteApprovalActions.approve({
        value: value,
        props: memberProps(DAVE),
      });

    expect(first.outcome).toBe(PublicNoteApprovalPressOutcome.Decided);
    expect(second.outcome).toBe(PublicNoteApprovalPressOutcome.News);
    expect(second.answer.markdown).toMatch(
      /^✅ This public note on .+ was already approved by \*\*Bob\*\* at .+\. It is published on status pages\.$/,
    );
    expect(world.writes).toHaveLength(1);
    expect(world.published).toHaveLength(1);
    expect(world.workflows).toHaveLength(1);
    expect(world.told).toHaveLength(1);
  });

  test("one approves while the other rejects: whichever lands first stands, the other is told", async () => {
    const asBothRead: typeof world.stored = { ...world.stored };
    const value: PublicNoteApprovalButtonValue = buttonValue();

    await WorkspacePublicNoteApprovalActions.reject({
      value: value,
      props: memberProps(DAVE),
      reason: "Hold it.",
    });

    world.readsAsOf = asBothRead;

    const late: PublicNoteApprovalPressAnswer =
      await WorkspacePublicNoteApprovalActions.approve({
        value: value,
        props: memberProps(BOB),
      });

    expect(late.outcome).toBe(PublicNoteApprovalPressOutcome.News);
    expect(late.answer.markdown).toContain("was already rejected by **Dave**");
    expect(world.writes).toHaveLength(1);
    expect(world.stored.approvalStatus).toBe(PublicNoteApprovalStatus.Rejected);
  });

  test("pressed together: exactly one decides", async () => {
    const value: PublicNoteApprovalButtonValue = buttonValue();

    const both: Array<PublicNoteApprovalPressAnswer> = await Promise.all([
      WorkspacePublicNoteApprovalActions.approve({
        value: value,
        props: memberProps(BOB),
      }),
      WorkspacePublicNoteApprovalActions.approve({
        value: value,
        props: memberProps(DAVE),
      }),
    ]);

    expect(
      both.filter((pressed: PublicNoteApprovalPressAnswer) => {
        return pressed.outcome === PublicNoteApprovalPressOutcome.Decided;
      }),
    ).toHaveLength(1);
    expect(world.writes).toHaveLength(1);
    expect(storedRound().approvals).toHaveLength(1);
  });

  test("a decision the engine says was made meanwhile, with nothing else changed, is the engine's words", async () => {
    const value: PublicNoteApprovalButtonValue = buttonValue();
    // A write that moved the version but decided nothing.
    world.readsAsOf = { ...world.stored };
    world.stored = { ...world.stored, version: world.stored.version + 1 };

    const pressed: PublicNoteApprovalPressAnswer =
      await WorkspacePublicNoteApprovalActions.approve({
        value: value,
        props: memberProps(BOB),
      });

    expect(pressed.outcome).toBe(PublicNoteApprovalPressOutcome.Refused);
    expect(pressed.answer.text).toBe(
      PublicNoteApprovalMessages.decidedMeanwhile,
    );
  });
});

describe("forged, replayed and stale presses decide nothing more than the Dashboard would", () => {
  test("a value this installation did not sign is refused before anything is read", () => {
    expect(() => {
      return WorkspacePublicNoteApprovalActions.readValue(NOTE_ID.toString());
    }).toThrow(BadDataException);
    expect(() => {
      return WorkspacePublicNoteApprovalActions.readValue(
        `${encodedValue().slice(0, -2)}xx`,
      );
    }).toThrow(
      "This button could not be verified, so nothing was decided. Open the public note in OneUptime instead.",
    );
  });

  test("a value naming a note that is not there, another record or another project finds no note", async () => {
    for (const overrides of [
      { noteId: new ObjectID("99999999-9999-4999-8999-999999999999") },
      { recordId: new ObjectID("88888888-8888-4888-8888-888888888888") },
      { projectId: OTHER_PROJECT_ID },
    ]) {
      const pressed: PublicNoteApprovalPressAnswer = await approve(
        BOB,
        overrides,
      );

      expect(pressed.outcome).toBe(PublicNoteApprovalPressOutcome.News);
      expect(pressed.answer.text).toBe(
        WorkspacePublicNoteApprovalActions.getGoneMessage(),
      );
    }

    expect(world.writes).toEqual([]);
  });

  test("the same Approve sent again decides once: the second is news", async () => {
    const value: PublicNoteApprovalButtonValue = buttonValue();

    const first: PublicNoteApprovalPressAnswer =
      await WorkspacePublicNoteApprovalActions.approve({
        value: value,
        props: memberProps(BOB),
      });
    const again: PublicNoteApprovalPressAnswer =
      await WorkspacePublicNoteApprovalActions.approve({
        value: value,
        props: memberProps(BOB),
      });

    expect(first.outcome).toBe(PublicNoteApprovalPressOutcome.Decided);
    expect(again.outcome).toBe(PublicNoteApprovalPressOutcome.News);
    expect(again.answer.markdown).toContain(
      "was already approved for step 1 of 2 (Support) by **Bob**",
    );
    expect(world.writes).toHaveLength(1);
  });

  test("the same Reject sent again rejects once", async () => {
    const value: PublicNoteApprovalButtonValue = buttonValue();

    await WorkspacePublicNoteApprovalActions.reject({
      value: value,
      props: memberProps(BOB),
      reason: "No.",
    });
    const again: PublicNoteApprovalPressAnswer =
      await WorkspacePublicNoteApprovalActions.reject({
        value: value,
        props: memberProps(BOB),
        reason: "No.",
      });

    expect(again.outcome).toBe(PublicNoteApprovalPressOutcome.News);
    expect(again.answer.markdown).toContain("was already rejected by **Bob**");
    expect(world.writes).toHaveLength(1);
    expect(world.told).toHaveLength(1);
  });

  test("whoever presses decides as themselves: a value made for Bob's message gives Eve nothing", async () => {
    const pressed: PublicNoteApprovalPressAnswer = await approve(EVE);

    expect(pressed.outcome).toBe(PublicNoteApprovalPressOutcome.Refused);
    expect(world.writes).toEqual([]);
  });
});

describe("Reject's form", () => {
  test("an approver gets the form: the Dashboard's question, required, at most the longest reason, and the button's value", async () => {
    const result: PublicNoteRejectFormResult =
      await WorkspacePublicNoteApprovalActions.getRejectForm({
        value: buttonValue(),
        props: memberProps(BOB),
        workspaceType: WorkspaceType.Slack,
      });

    expect(result.answer).toBeUndefined();
    expect(result.form?.title).toBe("Reject this public note?");
    expect(result.form?.submitButtonTitle).toBe("Reject");
    expect(result.form?.actionId).toBe(SlackActionType.SubmitRejectPublicNote);
    expect(
      WorkspacePublicNoteApproval.readValue(result.form?.actionValue),
    ).toEqual(buttonValue());

    const intro: WorkspacePayloadMarkdown = result.form!
      .blocks[0] as WorkspacePayloadMarkdown;
    expect(intro.text).toBe(
      "Public note on **Incident INC-42** - Checkout is down\n\nIt will not be published. Its author sees your reason and can change the note and send it again.",
    );

    const reason: WorkspaceTextAreaBlock = result.form!
      .blocks[1] as WorkspaceTextAreaBlock;
    expect(reason.blockId).toBe(PUBLIC_NOTE_REJECT_REASON_FIELD);
    expect(reason.label).toBe("Why are you rejecting it?");
    expect(reason.description).toBe("The author sees this.");
    expect(reason.optional).toBe(false);
    expect(reason.maxLength).toBe(PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH);
    expect(world.writes).toEqual([]);
  });

  test("in Mattermost, whose labels are short, the question is the field's help", async () => {
    const result: PublicNoteRejectFormResult =
      await WorkspacePublicNoteApprovalActions.getRejectForm({
        value: buttonValue(),
        props: memberProps(BOB),
        workspaceType: WorkspaceType.Mattermost,
      });

    const reason: WorkspaceTextAreaBlock = result.form!
      .blocks[1] as WorkspaceTextAreaBlock;
    expect(reason.label).toBe("Reason");
    expect(reason.description).toBe(
      "Why are you rejecting it? The author sees this.",
    );
  });

  test("the sender, somebody the step does not name, and a note decided already get no form", async () => {
    world.steps = [{ ...SUPPORT, userIds: [ALICE, BOB] }, LEGAL];

    const bySender: PublicNoteRejectFormResult =
      await WorkspacePublicNoteApprovalActions.getRejectForm({
        value: buttonValue(),
        props: memberProps(ALICE),
        workspaceType: WorkspaceType.Slack,
      });

    expect(bySender.form).toBeUndefined();
    expect(bySender.answer?.answer.text).toBe(
      PublicNoteApprovalMessages.sentByYou,
    );

    const byStranger: PublicNoteRejectFormResult =
      await WorkspacePublicNoteApprovalActions.getRejectForm({
        value: buttonValue(),
        props: memberProps(EVE),
        workspaceType: WorkspaceType.Slack,
      });

    expect(byStranger.form).toBeUndefined();
    expect(byStranger.answer?.outcome).toBe(
      PublicNoteApprovalPressOutcome.Refused,
    );

    const value: PublicNoteApprovalButtonValue = buttonValue();
    await reject(BOB, "No.");

    const late: PublicNoteRejectFormResult =
      await WorkspacePublicNoteApprovalActions.getRejectForm({
        value: value,
        props: memberProps(BOB),
        workspaceType: WorkspaceType.Slack,
      });

    expect(late.form).toBeUndefined();
    expect(late.answer?.outcome).toBe(PublicNoteApprovalPressOutcome.News);
  });

  test("the earlier approver named on this step may still reject: the form opens", async () => {
    world.steps = [SUPPORT, { ...LEGAL, userIds: [BOB, CAROL] }];
    await approve(BOB);

    const result: PublicNoteRejectFormResult =
      await WorkspacePublicNoteApprovalActions.getRejectForm({
        value: buttonValue(),
        props: memberProps(BOB),
        workspaceType: WorkspaceType.MicrosoftTeams,
      });

    expect(result.form).toBeDefined();
  });
});

describe("Approve pressed before the chat account was connected, decided once it is", () => {
  test("decided as the member it was connected to", async () => {
    const pressed: PublicNoteApprovalPressAnswer =
      await WorkspacePublicNoteApprovalActions.approveOnceConnected({
        value: encodedValue(),
        projectId: PROJECT_ID,
        userId: new ObjectID(BOB),
      });

    expect(pressed.outcome).toBe(PublicNoteApprovalPressOutcome.Decided);
    expect(storedRound().approvals[0]?.userId).toBe(BOB);
  });

  test("only while the note is still what its message showed", async () => {
    const value: string = encodedValue();
    world.stored = { ...world.stored, note: "Rewritten meanwhile." };

    const pressed: PublicNoteApprovalPressAnswer =
      await WorkspacePublicNoteApprovalActions.approveOnceConnected({
        value: value,
        projectId: PROJECT_ID,
        userId: new ObjectID(BOB),
      });

    expect(pressed.outcome).toBe(PublicNoteApprovalPressOutcome.News);
    expect(world.writes).toEqual([]);
  });

  test("a value this installation did not sign, or signed for another project, is refused", async () => {
    for (const data of [
      { value: "not-a-value", projectId: PROJECT_ID },
      { value: encodedValue(), projectId: OTHER_PROJECT_ID },
    ]) {
      const pressed: PublicNoteApprovalPressAnswer =
        await WorkspacePublicNoteApprovalActions.approveOnceConnected({
          ...data,
          userId: new ObjectID(BOB),
        });

      expect(pressed.outcome).toBe(PublicNoteApprovalPressOutcome.Refused);
      expect(pressed.answer.text).toBe(
        WorkspacePublicNoteApprovalActions.getUnverifiedMessage(),
      );
    }

    expect(world.writes).toEqual([]);
  });

  test("somebody who is no longer a member is told so, and nothing is decided", async () => {
    getJestSpyOn(
      WorkspaceActionAuthorization,
      "getProjectMemberProps",
    ).mockRejectedValue(
      new NotAuthorizedException(
        WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
      ) as never,
    );

    const pressed: PublicNoteApprovalPressAnswer =
      await WorkspacePublicNoteApprovalActions.approveOnceConnected({
        value: encodedValue(),
        projectId: PROJECT_ID,
        userId: new ObjectID(BOB),
      });

    expect(pressed.outcome).toBe(PublicNoteApprovalPressOutcome.Refused);
    expect(pressed.answer.text).toBe(
      WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
    );
    expect(world.writes).toEqual([]);
  });
});

describe("the press, in the workspace logs", () => {
  test("named for what was pressed, on the incident", async () => {
    await WorkspacePublicNoteApprovalActions.logPress({
      value: buttonValue(),
      workspaceType: WorkspaceType.Slack,
      userId: new ObjectID(BOB),
      buttonAction: "approve_public_note",
      channelId: "D0DIRECT",
    });

    expect(world.logged).toEqual(["approve_public_note"]);
    expect(INCIDENT_ID).toBeDefined();
  });
});
