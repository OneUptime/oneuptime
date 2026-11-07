import PublicNoteApprovalWrites, {
  PUBLIC_NOTE_APPROVAL_COLUMNS,
  PublicNoteApprovalWrite,
} from "../../../../Server/Utils/Notes/PublicNoteApprovalWrites";
import PublicNoteApproval, {
  PublicNoteApprovalRound,
  PublicNoteApprovalState,
  PublicNoteApprovalStatus,
} from "../../../../Types/StatusPage/PublicNoteApproval";
import StatusPageSubscriberNotificationStatus from "../../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberUpdateNotification from "../../../../Types/StatusPage/SubscriberUpdateNotification";
import { describe, expect, test } from "@jest/globals";

/*
 * What each step of a public note's approval writes to the note (issue
 * #5720). The engine decides with these and writes their result in one
 * version-checked update, so these are the whole of what a step changes:
 * a column left out here is a column a decision never touches.
 */

const NOW: Date = new Date("2026-11-07T10:00:00.000Z");
const EARLIER: Date = new Date("2026-11-07T09:00:00.000Z");
const ALICE: string = "a1a1a1a1-0000-4000-8000-000000000001";
const BOB: string = "b2b2b2b2-0000-4000-8000-000000000002";

function round(
  overrides: Partial<PublicNoteApprovalRound> = {},
): PublicNoteApprovalRound {
  return {
    submittedAt: EARLIER.toISOString(),
    submittedByUserId: ALICE,
    isEdit: false,
    approvals: [],
    ...overrides,
  };
}

function readRound(write: PublicNoteApprovalWrite): PublicNoteApprovalRound {
  return PublicNoteApproval.readRound(write["approval"])!;
}

describe("PublicNoteApprovalWrites.forCreate", () => {
  test("a note whose project asks for nothing is published, as every note was, and carries no approval", () => {
    expect(
      PublicNoteApprovalWrites.forCreate({
        isRequired: false,
        now: NOW,
        submittedByUserId: ALICE,
        keepPostedAt: false,
      }),
    ).toEqual({
      isPublished: true,
      approvalStatus: null,
      approval: null,
      pendingNote: null,
    });
  });

  test("a note whose project asks for approval is held: not published, waiting, sent by its author", () => {
    const write: PublicNoteApprovalWrite = PublicNoteApprovalWrites.forCreate({
      isRequired: true,
      now: NOW,
      submittedByUserId: ALICE,
      keepPostedAt: false,
    });

    expect(write["isPublished"]).toBe(false);
    expect(write["approvalStatus"]).toBe(
      PublicNoteApprovalStatus.WaitingForApproval,
    );
    expect(write["pendingNote"]).toBeNull();
    expect(readRound(write)).toEqual({
      submittedAt: NOW.toISOString(),
      submittedByUserId: ALICE,
      isEdit: false,
      approvals: [],
    });
  });

  test("a time chosen when it was written is kept through the approval", () => {
    expect(
      readRound(
        PublicNoteApprovalWrites.forCreate({
          isRequired: true,
          now: NOW,
          submittedByUserId: ALICE,
          keepPostedAt: true,
        }),
      ).keepPostedAt,
    ).toBe(true);
  });

  test("every approval column is written either way, so nothing a caller sent stands", () => {
    for (const isRequired of [true, false]) {
      expect(
        Object.keys(
          PublicNoteApprovalWrites.forCreate({
            isRequired,
            now: NOW,
            keepPostedAt: false,
          }),
        ).sort(),
      ).toEqual([...PUBLIC_NOTE_APPROVAL_COLUMNS].sort());
    }
  });

  test("a note OneUptime writes with nobody behind it is sent by nobody", () => {
    expect(
      readRound(
        PublicNoteApprovalWrites.forCreate({
          isRequired: true,
          now: NOW,
          submittedByUserId: null,
          keepPostedAt: false,
        }),
      ).submittedByUserId,
    ).toBeUndefined();
  });
});

describe("PublicNoteApprovalWrites.forUnpublishedEdit", () => {
  test("a waiting or rejected note edited starts again from the first step, sent by its editor", () => {
    const write: PublicNoteApprovalWrite =
      PublicNoteApprovalWrites.forUnpublishedEdit({
        round: round({
          approvals: [{ stepId: "s1", userId: BOB, at: EARLIER.toISOString() }],
          rejection: {
            userId: BOB,
            at: EARLIER.toISOString(),
            reason: "No vendor names.",
          },
        }),
        now: NOW,
        editorUserId: BOB,
      });

    expect(write["approvalStatus"]).toBe(
      PublicNoteApprovalStatus.WaitingForApproval,
    );
    expect(readRound(write)).toEqual({
      submittedAt: NOW.toISOString(),
      submittedByUserId: BOB,
      isEdit: false,
      approvals: [],
    });
    // It stays off status pages: publishing is not this write's to do.
    expect(write["isPublished"]).toBeUndefined();
  });

  test("keeps a posting time its author chose", () => {
    expect(
      readRound(
        PublicNoteApprovalWrites.forUnpublishedEdit({
          round: round({ keepPostedAt: true }),
          now: NOW,
          editorUserId: ALICE,
        }),
      ).keepPostedAt,
    ).toBe(true);
  });
});

describe("PublicNoteApprovalWrites.forHeldEdit", () => {
  test("an edit of a published note waits in pendingNote, and remembers how the note stood", () => {
    const approved: PublicNoteApprovalRound = round({
      approvals: [{ stepId: "s1", userId: BOB, at: EARLIER.toISOString() }],
      publishedAt: EARLIER.toISOString(),
    });

    const write: PublicNoteApprovalWrite = PublicNoteApprovalWrites.forHeldEdit(
      {
        state: PublicNoteApprovalState.Published,
        approvalStatus: PublicNoteApprovalStatus.Approved,
        round: approved,
        pendingNote: "We found the cause.",
        now: NOW,
        editorUserId: ALICE,
        notifySubscribersOfEdit: true,
      },
    );

    expect(write["pendingNote"]).toBe("We found the cause.");
    expect(write["approvalStatus"]).toBe(
      PublicNoteApprovalStatus.WaitingForApproval,
    );
    // Neither the note's text nor whether it is published changes yet.
    expect(write["note"]).toBeUndefined();
    expect(write["isPublished"]).toBeUndefined();

    const held: PublicNoteApprovalRound = readRound(write);
    expect(held.isEdit).toBe(true);
    expect(held.submittedByUserId).toBe(ALICE);
    expect(held.notifySubscribersOfEdit).toBe(true);
    expect(held.before?.status).toBe(PublicNoteApprovalStatus.Approved);
    expect(held.before?.round?.approvals).toEqual(approved.approvals);
  });

  test("a note published before approval existed remembers it had none", () => {
    const held: PublicNoteApprovalRound = readRound(
      PublicNoteApprovalWrites.forHeldEdit({
        state: PublicNoteApprovalState.Published,
        approvalStatus: null,
        round: null,
        pendingNote: "Edited.",
        now: NOW,
        editorUserId: ALICE,
        notifySubscribersOfEdit: false,
      }),
    );

    expect(held.before).toEqual({ status: null, round: null });
    expect(held.notifySubscribersOfEdit).toBeUndefined();
  });

  test("an edit that replaces one already waiting keeps what the note was before that one", () => {
    const original: PublicNoteApprovalRound = round({
      approvals: [{ stepId: "s1", userId: BOB, at: EARLIER.toISOString() }],
    });
    const firstEdit: PublicNoteApprovalRound = round({
      isEdit: true,
      before: { status: PublicNoteApprovalStatus.Approved, round: original },
    });

    const held: PublicNoteApprovalRound = readRound(
      PublicNoteApprovalWrites.forHeldEdit({
        state: PublicNoteApprovalState.EditWaitingForApproval,
        approvalStatus: PublicNoteApprovalStatus.WaitingForApproval,
        round: firstEdit,
        pendingNote: "Second try.",
        now: NOW,
        editorUserId: BOB,
        notifySubscribersOfEdit: false,
      }),
    );

    expect(held.before?.status).toBe(PublicNoteApprovalStatus.Approved);
    expect(held.before?.round?.approvals).toEqual(original.approvals);
    expect(held.submittedByUserId).toBe(BOB);
  });

  test("an unknown stored status is remembered as none", () => {
    expect(
      readRound(
        PublicNoteApprovalWrites.forHeldEdit({
          state: PublicNoteApprovalState.Published,
          approvalStatus: "Something else",
          round: null,
          pendingNote: "Edited.",
          now: NOW,
          notifySubscribersOfEdit: false,
        }),
      ).before?.status,
    ).toBeNull();
  });
});

describe("PublicNoteApprovalWrites.forDroppedEdit", () => {
  test("goes back to how the note stood before the edit was sent", () => {
    const original: PublicNoteApprovalRound = round({
      approvals: [{ stepId: "s1", userId: BOB, at: EARLIER.toISOString() }],
    });

    const write: PublicNoteApprovalWrite =
      PublicNoteApprovalWrites.forDroppedEdit(
        round({
          isEdit: true,
          before: {
            status: PublicNoteApprovalStatus.Approved,
            round: original,
          },
        }),
      );

    expect(write["pendingNote"]).toBeNull();
    expect(write["approvalStatus"]).toBe(PublicNoteApprovalStatus.Approved);
    expect(readRound(write).approvals).toEqual(original.approvals);
    expect(write["isPublished"]).toBeUndefined();
    expect(write["note"]).toBeUndefined();
  });

  test("a note that had no approval before the edit has none again", () => {
    expect(
      PublicNoteApprovalWrites.forDroppedEdit(
        round({ isEdit: true, before: { status: null, round: null } }),
      ),
    ).toEqual({ pendingNote: null, approvalStatus: null, approval: null });
    expect(PublicNoteApprovalWrites.forDroppedEdit(null)).toEqual({
      pendingNote: null,
      approvalStatus: null,
      approval: null,
    });
  });
});

describe("PublicNoteApprovalWrites: a step decided", () => {
  test("a step approved with another to go writes the round alone: the note still waits", () => {
    const approvedOnce: PublicNoteApprovalRound = round({
      approvals: [{ stepId: "s1", userId: BOB, at: NOW.toISOString() }],
    });

    expect(PublicNoteApprovalWrites.forStepApproval(approvedOnce)).toEqual({
      approval: PublicNoteApproval.toJSON(approvedOnce),
    });
  });

  test("a rejection marks it rejected, with the round that holds the reason", () => {
    const rejected: PublicNoteApprovalRound = round({
      rejection: { userId: BOB, at: NOW.toISOString(), reason: "Too early." },
    });

    expect(PublicNoteApprovalWrites.forRejection(rejected)).toEqual({
      approvalStatus: PublicNoteApprovalStatus.Rejected,
      approval: PublicNoteApproval.toJSON(rejected),
    });
  });
});

describe("PublicNoteApprovalWrites.forResubmission", () => {
  test("a rejected note sent again starts a new round from the first step", () => {
    const write: PublicNoteApprovalWrite =
      PublicNoteApprovalWrites.forResubmission({
        state: PublicNoteApprovalState.Rejected,
        round: round({
          keepPostedAt: true,
          rejection: {
            userId: BOB,
            at: EARLIER.toISOString(),
            reason: "Wording.",
          },
        }),
        now: NOW,
        submittedByUserId: ALICE,
      });

    expect(write["approvalStatus"]).toBe(
      PublicNoteApprovalStatus.WaitingForApproval,
    );
    expect(readRound(write)).toEqual({
      submittedAt: NOW.toISOString(),
      submittedByUserId: ALICE,
      isEdit: false,
      keepPostedAt: true,
      approvals: [],
    });
  });

  test("a rejected edit sent again is still an edit, asking what it asked", () => {
    const original: PublicNoteApprovalRound = round();

    const sentAgain: PublicNoteApprovalRound = readRound(
      PublicNoteApprovalWrites.forResubmission({
        state: PublicNoteApprovalState.EditRejected,
        round: round({
          isEdit: true,
          notifySubscribersOfEdit: true,
          before: {
            status: PublicNoteApprovalStatus.Approved,
            round: original,
          },
          rejection: {
            userId: BOB,
            at: EARLIER.toISOString(),
            reason: "Wording.",
          },
        }),
        now: NOW,
        submittedByUserId: ALICE,
      }),
    );

    expect(sentAgain.isEdit).toBe(true);
    expect(sentAgain.notifySubscribersOfEdit).toBe(true);
    expect(sentAgain.before?.status).toBe(PublicNoteApprovalStatus.Approved);
    expect(sentAgain.rejection).toBeUndefined();
  });
});

describe("PublicNoteApprovalWrites.forPublish", () => {
  test("a new note approved goes on status pages, filed as posted now", () => {
    const approved: PublicNoteApprovalRound = round({
      approvals: [{ stepId: "s1", userId: BOB, at: NOW.toISOString() }],
      publishedAt: NOW.toISOString(),
    });

    expect(
      PublicNoteApprovalWrites.forPublish({
        state: PublicNoteApprovalState.WaitingForApproval,
        round: approved,
        roundAsSent: round(),
        pendingNote: null,
        now: NOW,
      }),
    ).toEqual({
      approvalStatus: PublicNoteApprovalStatus.Approved,
      approval: PublicNoteApproval.toJSON(approved),
      isPublished: true,
      postedAt: NOW,
    });
  });

  test("a time its author chose is kept", () => {
    const write: PublicNoteApprovalWrite = PublicNoteApprovalWrites.forPublish({
      state: PublicNoteApprovalState.WaitingForApproval,
      round: round({ keepPostedAt: true }),
      roundAsSent: round({ keepPostedAt: true }),
      pendingNote: null,
      now: NOW,
    });

    expect(write["isPublished"]).toBe(true);
    expect(write).not.toHaveProperty("postedAt");
  });

  /*
   * The subscribers' notification was queued when the note was written: the
   * jobs send published notes only, so publishing is what sends it - a
   * write of the status here would send it twice, or not at all.
   */
  test("a new note's notification is left as it was queued", () => {
    const write: PublicNoteApprovalWrite = PublicNoteApprovalWrites.forPublish({
      state: PublicNoteApprovalState.WaitingForApproval,
      round: round(),
      roundAsSent: round(),
      pendingNote: null,
      now: NOW,
    });

    expect(write).not.toHaveProperty(
      "subscriberNotificationStatusOnNoteCreated",
    );
    expect(write).not.toHaveProperty(
      "subscriberNotificationStatusOnNoteUpdated",
    );
  });

  test("an edit approved takes the note's place, and its waiting text is cleared", () => {
    const approved: PublicNoteApprovalRound = round({
      isEdit: true,
      before: { status: PublicNoteApprovalStatus.Approved, round: round() },
      approvals: [{ stepId: "s1", userId: BOB, at: NOW.toISOString() }],
    });

    const write: PublicNoteApprovalWrite = PublicNoteApprovalWrites.forPublish({
      state: PublicNoteApprovalState.EditWaitingForApproval,
      round: approved,
      roundAsSent: approved,
      pendingNote: "We found the cause.",
      now: NOW,
    });

    expect(write["note"]).toBe("We found the cause.");
    expect(write["pendingNote"]).toBeNull();
    expect(write["approvalStatus"]).toBe(PublicNoteApprovalStatus.Approved);
    // What it stood on before the edit is history now.
    expect(readRound(write).before).toBeUndefined();
    // Already published: neither published again nor moved in time.
    expect(write).not.toHaveProperty("isPublished");
    expect(write).not.toHaveProperty("postedAt");
    // Nobody asked to tell subscribers about the edit.
    expect(write).not.toHaveProperty(
      "subscriberNotificationStatusOnNoteUpdated",
    );
  });

  test("an edit whose editor asked to tell subscribers queues the update notification as it is published", () => {
    const sent: PublicNoteApprovalRound = round({
      isEdit: true,
      notifySubscribersOfEdit: true,
    });

    const write: PublicNoteApprovalWrite = PublicNoteApprovalWrites.forPublish({
      state: PublicNoteApprovalState.EditWaitingForApproval,
      round: sent,
      roundAsSent: sent,
      pendingNote: "Edited.",
      now: NOW,
    });

    expect(write["subscriberNotificationStatusOnNoteUpdated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    expect(write["subscriberNotificationStatusMessageOnNoteUpdated"]).toBe(
      SubscriberUpdateNotification.queuedMessage,
    );
  });

  test("published by a person once approval is off: nobody approved it, so it carries no approval", () => {
    expect(
      PublicNoteApprovalWrites.forPublish({
        state: PublicNoteApprovalState.Rejected,
        round: null,
        roundAsSent: round(),
        pendingNote: null,
        now: NOW,
      }),
    ).toEqual({
      approvalStatus: null,
      approval: null,
      isPublished: true,
      postedAt: NOW,
    });

    const edit: PublicNoteApprovalWrite = PublicNoteApprovalWrites.forPublish({
      state: PublicNoteApprovalState.EditRejected,
      round: null,
      roundAsSent: round({ isEdit: true }),
      pendingNote: null,
      now: NOW,
    });

    // An edit with no text left publishes as empty, never as "null".
    expect(edit["note"]).toBe("");
    expect(edit["approvalStatus"]).toBeNull();
  });
});

describe("PublicNoteApprovalWrites: what an edit changes", () => {
  test("text: changed only when sent and different from what is stored", () => {
    expect(PublicNoteApprovalWrites.isChangedText(undefined, "a")).toBe(false);
    expect(PublicNoteApprovalWrites.isChangedText("a", "a")).toBe(false);
    expect(PublicNoteApprovalWrites.isChangedText("b", "a")).toBe(true);
    // Nothing and empty are the same text.
    expect(PublicNoteApprovalWrites.isChangedText("", null)).toBe(false);
    expect(PublicNoteApprovalWrites.isChangedText(null, "")).toBe(false);
    expect(PublicNoteApprovalWrites.isChangedText(null, "a")).toBe(true);
  });

  test("files: the ids named, as a set, as records or ids, in any case", () => {
    const stored: Array<string> = ["AAA", "bbb"];

    expect(PublicNoteApprovalWrites.isChangedFiles(undefined, stored)).toBe(
      false,
    );
    expect(
      PublicNoteApprovalWrites.isChangedFiles(
        [{ _id: "bbb" }, { id: "aaa" }],
        stored,
      ),
    ).toBe(false);
    expect(PublicNoteApprovalWrites.isChangedFiles(["aaa"], stored)).toBe(true);
    expect(
      PublicNoteApprovalWrites.isChangedFiles(["aaa", "bbb", "ccc"], stored),
    ).toBe(true);
    expect(
      PublicNoteApprovalWrites.isChangedFiles(["aaa", "ccc"], stored),
    ).toBe(true);
    expect(PublicNoteApprovalWrites.isChangedFiles([], [])).toBe(false);
    expect(PublicNoteApprovalWrites.isChangedFiles(null, [])).toBe(false);
    expect(PublicNoteApprovalWrites.isChangedFiles(null, ["aaa"])).toBe(true);
  });

  test("idsOf reads records and ids, and skips what names none", () => {
    expect(
      PublicNoteApprovalWrites.idsOf([
        "AbC",
        { _id: "DEF" },
        { id: "ghi" },
        {},
        null,
        42,
        "",
      ]),
    ).toEqual(["abc", "def", "ghi"]);
    expect(PublicNoteApprovalWrites.idsOf("abc")).toEqual([]);
    expect(PublicNoteApprovalWrites.idsOf(undefined)).toEqual([]);
  });
});
