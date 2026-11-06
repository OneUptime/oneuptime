import { describe, expect, test } from "@jest/globals";
import PublicNoteApproval, {
  PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH,
  PublicNoteApprovalDecision,
  PublicNoteApprovalMessages,
  PublicNoteApprovalPosition,
  PublicNoteApprovalRound,
  PublicNoteApprovalState,
  PublicNoteApprovalStatus,
  PublicNoteApprovalStepRule,
} from "../../../Types/StatusPage/PublicNoteApproval";
import { SeededRandom, seededRandom, shuffled } from "../../Helpers/SeededRandom";

/*
 * PUBLIC NOTE APPROVAL, THE RULES THEMSELVES (Types/StatusPage/PublicNoteApproval).
 *
 * Where a note stands, which step it waits for when the steps change under
 * it, who may decide, who is asked, and how a round of approval is written
 * and read back. The server decides with these and the Dashboard shows
 * them, so every branch is pinned here, with a seeded sweep over random
 * step lists and approval orders for the invariants.
 */

const NOW: Date = new Date("2026-11-06T10:00:00.000Z");
const LATER: Date = new Date("2026-11-06T10:05:00.000Z");

const ALICE: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOB: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CAROL: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DAVE: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SUPPORT_TEAM: string = "11111111-1111-4111-8111-111111111111";
const LEGAL_TEAM: string = "22222222-2222-4222-8222-222222222222";

function step(
  id: string,
  order: number,
  data: Partial<PublicNoteApprovalStepRule> = {},
): PublicNoteApprovalStepRule {
  return {
    id,
    order,
    userIds: [],
    teamIds: [],
    ...data,
  };
}

const SUPPORT: PublicNoteApprovalStepRule = step("step-support", 1, {
  userIds: [BOB],
  teamIds: [SUPPORT_TEAM],
});
const LEGAL: PublicNoteApprovalStepRule = step("step-legal", 2, {
  name: "Legal",
  userIds: [CAROL],
  teamIds: [LEGAL_TEAM],
});

function roundSentBy(
  userId: string | undefined,
  approvals: Array<{ stepId: string; userId: string }> = [],
): PublicNoteApprovalRound {
  return {
    submittedAt: NOW.toISOString(),
    ...(userId ? { submittedByUserId: userId } : {}),
    isEdit: false,
    approvals: approvals.map((given: { stepId: string; userId: string }) => {
      return { ...given, at: NOW.toISOString() };
    }),
  };
}

describe("getState: where a note stands, from its columns", () => {
  test.each([
    [true, null, PublicNoteApprovalState.Published],
    [true, undefined, PublicNoteApprovalState.Published],
    [undefined, undefined, PublicNoteApprovalState.Published],
    [null, null, PublicNoteApprovalState.Published],
    [true, PublicNoteApprovalStatus.Approved, PublicNoteApprovalState.Published],
    [
      true,
      PublicNoteApprovalStatus.WaitingForApproval,
      PublicNoteApprovalState.EditWaitingForApproval,
    ],
    [true, PublicNoteApprovalStatus.Rejected, PublicNoteApprovalState.EditRejected],
    [
      false,
      PublicNoteApprovalStatus.WaitingForApproval,
      PublicNoteApprovalState.WaitingForApproval,
    ],
    [false, PublicNoteApprovalStatus.Rejected, PublicNoteApprovalState.Rejected],
  ])(
    "isPublished %p with status %p reads as %p",
    (
      isPublished: boolean | null | undefined,
      status: string | null | undefined,
      expected: PublicNoteApprovalState,
    ) => {
      expect(
        PublicNoteApproval.getState({
          isPublished: isPublished,
          approvalStatus: status,
        }),
      ).toBe(expected);
    },
  );

  test("an unpublished note that is not rejected waits, whatever else it says: it is never published by a stray status", () => {
    for (const status of [
      null,
      undefined,
      PublicNoteApprovalStatus.Approved,
      "Published",
      "",
      "garbage",
    ]) {
      expect(
        PublicNoteApproval.getState({ isPublished: false, approvalStatus: status }),
      ).toBe(PublicNoteApprovalState.WaitingForApproval);
    }
  });

  test("a note read without its columns is published, as every note was before approval existed", () => {
    expect(PublicNoteApproval.getState(null)).toBe(
      PublicNoteApprovalState.Published,
    );
    expect(PublicNoteApproval.getState(undefined)).toBe(
      PublicNoteApprovalState.Published,
    );
    expect(PublicNoteApproval.getState({})).toBe(
      PublicNoteApprovalState.Published,
    );
  });

  test("isWaiting and isRejected split the states", () => {
    expect(
      Object.values(PublicNoteApprovalState).filter(
        (state: PublicNoteApprovalState) => {
          return PublicNoteApproval.isWaiting(state);
        },
      ),
    ).toEqual([
      PublicNoteApprovalState.WaitingForApproval,
      PublicNoteApprovalState.EditWaitingForApproval,
    ]);

    expect(
      Object.values(PublicNoteApprovalState).filter(
        (state: PublicNoteApprovalState) => {
          return PublicNoteApproval.isRejected(state);
        },
      ),
    ).toEqual([
      PublicNoteApprovalState.Rejected,
      PublicNoteApprovalState.EditRejected,
    ]);

    expect(PublicNoteApproval.isWaiting(PublicNoteApprovalState.Published)).toBe(
      false,
    );
    expect(
      PublicNoteApproval.isRejected(PublicNoteApprovalState.Published),
    ).toBe(false);
  });
});

describe("getPosition: the step a note waits for", () => {
  test("no steps: nobody to wait for", () => {
    expect(PublicNoteApproval.getPosition(roundSentBy(ALICE), [])).toEqual({
      step: null,
      number: 0,
      count: 0,
      isFinal: false,
      isAskedAgain: false,
    });
  });

  test("a new note waits for the first step; with one step, approving it is final", () => {
    const position: PublicNoteApprovalPosition = PublicNoteApproval.getPosition(
      roundSentBy(ALICE),
      [SUPPORT],
    );

    expect(position.step).toBe(SUPPORT);
    expect(position.number).toBe(1);
    expect(position.count).toBe(1);
    expect(position.isFinal).toBe(true);
    expect(position.isAskedAgain).toBe(false);
  });

  test("steps are gone through in their order, not the order they were read in", () => {
    const position: PublicNoteApprovalPosition = PublicNoteApproval.getPosition(
      roundSentBy(ALICE),
      [LEGAL, SUPPORT],
    );

    expect(position.step).toBe(SUPPORT);
    expect(position.isFinal).toBe(false);
  });

  test("after the first step approves, the note waits for the second, whose approval is final", () => {
    const position: PublicNoteApprovalPosition = PublicNoteApproval.getPosition(
      roundSentBy(ALICE, [{ stepId: SUPPORT.id, userId: BOB }]),
      [SUPPORT, LEGAL],
    );

    expect(position.step).toBe(LEGAL);
    expect(position.number).toBe(2);
    expect(position.count).toBe(2);
    expect(position.isFinal).toBe(true);
  });

  test("a step added before the one it waits for is asked first: the steps as they are now decide", () => {
    const review: PublicNoteApprovalStepRule = step("step-review", 0, {
      userIds: [DAVE],
    });

    const position: PublicNoteApprovalPosition = PublicNoteApproval.getPosition(
      roundSentBy(ALICE, [{ stepId: SUPPORT.id, userId: BOB }]),
      [SUPPORT, LEGAL, review],
    );

    expect(position.step).toBe(review);
    expect(position.number).toBe(1);
    expect(position.count).toBe(3);
    expect(position.isFinal).toBe(false);
  });

  test("an approval of a step taken out since counts for nothing", () => {
    const position: PublicNoteApprovalPosition = PublicNoteApproval.getPosition(
      roundSentBy(ALICE, [{ stepId: "step-gone", userId: BOB }]),
      [SUPPORT, LEGAL],
    );

    expect(position.step).toBe(SUPPORT);
    expect(position.isAskedAgain).toBe(false);
  });

  test("every step approved already (the one left was taken out): the last step is asked again, never published by a settings change", () => {
    const position: PublicNoteApprovalPosition = PublicNoteApproval.getPosition(
      roundSentBy(ALICE, [{ stepId: SUPPORT.id, userId: BOB }]),
      [SUPPORT],
    );

    expect(position.step).toBe(SUPPORT);
    expect(position.isFinal).toBe(true);
    expect(position.isAskedAgain).toBe(true);
  });

  test("steps with the same order are read in a stable order, by id", () => {
    const a: PublicNoteApprovalStepRule = step("a", 1);
    const b: PublicNoteApprovalStepRule = step("b", 1);

    expect(PublicNoteApproval.sortSteps([b, a])).toEqual([a, b]);
    expect(PublicNoteApproval.sortSteps([a, b])).toEqual([a, b]);
  });

  test("sorting never changes the list it is handed", () => {
    const steps: Array<PublicNoteApprovalStepRule> = [LEGAL, SUPPORT];
    PublicNoteApproval.sortSteps(steps);
    expect(steps).toEqual([LEGAL, SUPPORT]);
  });

  test("a sweep over random step lists and approval orders keeps every invariant", () => {
    const random: SeededRandom = seededRandom(5720);

    for (let run: number = 0; run < 400; run++) {
      const count: number = random(6);
      const steps: Array<PublicNoteApprovalStepRule> = [];

      for (let index: number = 0; index < count; index++) {
        steps.push(step(`s${index}`, random(4), { userIds: [`u${index}`] }));
      }

      // Approvals of some of the steps, and of some that no longer exist.
      const approved: Array<string> = shuffled(
        [...steps.map((rule: PublicNoteApprovalStepRule) => rule.id), "gone-1", "gone-2"],
        random,
      ).slice(0, random(count + 3));

      const round: PublicNoteApprovalRound = roundSentBy(
        ALICE,
        approved.map((stepId: string) => {
          return { stepId, userId: `approver-${stepId}` };
        }),
      );

      const position: PublicNoteApprovalPosition = PublicNoteApproval.getPosition(
        round,
        shuffled(steps, random),
      );

      if (steps.length === 0) {
        expect(position.step).toBeNull();
        continue;
      }

      expect(steps).toContain(position.step);
      expect(position.count).toBe(steps.length);
      expect(position.number).toBeGreaterThanOrEqual(1);
      expect(position.number).toBeLessThanOrEqual(steps.length);

      const sorted: Array<PublicNoteApprovalStepRule> =
        PublicNoteApproval.sortSteps(steps);
      const remaining: Array<PublicNoteApprovalStepRule> = sorted.filter(
        (rule: PublicNoteApprovalStepRule) => {
          return !approved.includes(rule.id);
        },
      );

      if (remaining.length === 0) {
        expect(position.isAskedAgain).toBe(true);
        expect(position.isFinal).toBe(true);
        expect(position.step).toBe(sorted[sorted.length - 1]);
      } else {
        expect(position.isAskedAgain).toBe(false);
        // The first step not yet approved, in order.
        expect(position.step).toBe(remaining[0]);
        expect(position.isFinal).toBe(remaining.length === 1);
        expect(approved).not.toContain(position.step!.id);
      }
    }
  });
});

describe("getStepLabel: how a sentence names a step", () => {
  test.each([
    [
      { step: null, number: 0, count: 0, isFinal: false, isAskedAgain: false },
      "an approval step",
    ],
    [
      { step: SUPPORT, number: 1, count: 1, isFinal: true, isAskedAgain: false },
      "the approval step",
    ],
    [
      { step: LEGAL, number: 1, count: 1, isFinal: true, isAskedAgain: false },
      'the approval step "Legal"',
    ],
    [
      { step: SUPPORT, number: 1, count: 2, isFinal: false, isAskedAgain: false },
      "step 1",
    ],
    [
      { step: LEGAL, number: 2, count: 2, isFinal: true, isAskedAgain: false },
      'step 2 ("Legal")',
    ],
  ])("%j reads as %p", (position: PublicNoteApprovalPosition, label: string) => {
    expect(PublicNoteApproval.getStepLabel(position)).toBe(label);
  });
});

describe("getDecisionRefusal: who may decide on a note", () => {
  const waiting: PublicNoteApprovalState =
    PublicNoteApprovalState.WaitingForApproval;

  test("an approver named on the step may approve and reject", () => {
    for (const decision of Object.values(PublicNoteApprovalDecision)) {
      expect(
        PublicNoteApproval.getDecisionRefusal({
          state: waiting,
          round: roundSentBy(ALICE),
          steps: [SUPPORT],
          userId: BOB,
          userTeamIds: [],
          decision,
        }),
      ).toBeNull();
    }
  });

  test("a member of a team the step names may decide; a member of another team may not", () => {
    expect(
      PublicNoteApproval.getDecisionRefusal({
        state: waiting,
        round: roundSentBy(ALICE),
        steps: [SUPPORT],
        userId: DAVE,
        userTeamIds: [SUPPORT_TEAM],
        decision: PublicNoteApprovalDecision.Approve,
      }),
    ).toBeNull();

    expect(
      PublicNoteApproval.getDecisionRefusal({
        state: waiting,
        round: roundSentBy(ALICE),
        steps: [SUPPORT],
        userId: DAVE,
        userTeamIds: [LEGAL_TEAM],
        decision: PublicNoteApprovalDecision.Approve,
      }),
    ).toBe(PublicNoteApprovalMessages.notAnApprover("the approval step"));
  });

  test("only the step the note waits for decides: a later step's approver may not jump the queue", () => {
    expect(
      PublicNoteApproval.getDecisionRefusal({
        state: waiting,
        round: roundSentBy(ALICE),
        steps: [SUPPORT, LEGAL],
        userId: CAROL,
        userTeamIds: [],
        decision: PublicNoteApprovalDecision.Approve,
      }),
    ).toBe(PublicNoteApprovalMessages.notAnApprover("step 1"));
  });

  test("nobody approves a note they sent for approval - not even an approver of the step", () => {
    for (const decision of Object.values(PublicNoteApprovalDecision)) {
      expect(
        PublicNoteApproval.getDecisionRefusal({
          state: waiting,
          round: roundSentBy(BOB),
          steps: [SUPPORT],
          userId: BOB,
          userTeamIds: [SUPPORT_TEAM],
          decision,
        }),
      ).toBe(PublicNoteApprovalMessages.sentByYou);
    }
  });

  test("nobody approves a note for two steps; they may still reject it", () => {
    const both: PublicNoteApprovalStepRule = step("step-legal-2", 2, {
      userIds: [BOB, CAROL],
    });
    const round: PublicNoteApprovalRound = roundSentBy(ALICE, [
      { stepId: SUPPORT.id, userId: BOB },
    ]);

    expect(
      PublicNoteApproval.getDecisionRefusal({
        state: waiting,
        round,
        steps: [SUPPORT, both],
        userId: BOB,
        userTeamIds: [],
        decision: PublicNoteApprovalDecision.Approve,
      }),
    ).toBe(PublicNoteApprovalMessages.approvedEarlierStep);

    expect(
      PublicNoteApproval.getDecisionRefusal({
        state: waiting,
        round,
        steps: [SUPPORT, both],
        userId: BOB,
        userTeamIds: [],
        decision: PublicNoteApprovalDecision.Reject,
      }),
    ).toBeNull();

    expect(
      PublicNoteApproval.getDecisionRefusal({
        state: waiting,
        round,
        steps: [SUPPORT, both],
        userId: CAROL,
        userTeamIds: [],
        decision: PublicNoteApprovalDecision.Approve,
      }),
    ).toBeNull();
  });

  test("an API key, a workflow or nobody at all is no approver", () => {
    for (const userId of [undefined, null, ""]) {
      expect(
        PublicNoteApproval.getDecisionRefusal({
          state: waiting,
          round: roundSentBy(ALICE),
          steps: [SUPPORT],
          userId,
          userTeamIds: [SUPPORT_TEAM],
          decision: PublicNoteApprovalDecision.Approve,
        }),
      ).toBe(PublicNoteApprovalMessages.notAPerson);
    }
  });

  test("a note that is not waiting takes no decision", () => {
    for (const state of [
      PublicNoteApprovalState.Published,
      PublicNoteApprovalState.Rejected,
      PublicNoteApprovalState.EditRejected,
    ]) {
      expect(
        PublicNoteApproval.getDecisionRefusal({
          state,
          round: roundSentBy(ALICE),
          steps: [SUPPORT],
          userId: BOB,
          userTeamIds: [],
          decision: PublicNoteApprovalDecision.Approve,
        }),
      ).toBe(PublicNoteApprovalMessages.notWaiting);
    }
  });

  test("an edit waiting for approval is decided on like a new note", () => {
    expect(
      PublicNoteApproval.getDecisionRefusal({
        state: PublicNoteApprovalState.EditWaitingForApproval,
        round: { ...roundSentBy(ALICE), isEdit: true },
        steps: [SUPPORT],
        userId: BOB,
        userTeamIds: [],
        decision: PublicNoteApprovalDecision.Approve,
      }),
    ).toBeNull();
  });

  test("with no steps, nobody can approve - and is told who can fix it", () => {
    expect(
      PublicNoteApproval.getDecisionRefusal({
        state: waiting,
        round: roundSentBy(ALICE),
        steps: [],
        userId: BOB,
        userTeamIds: [],
        decision: PublicNoteApprovalDecision.Approve,
      }),
    ).toBe(PublicNoteApprovalMessages.noSteps);
  });

  test("a note OneUptime wrote (no sender) is approved by any approver of its step", () => {
    expect(
      PublicNoteApproval.getDecisionRefusal({
        state: waiting,
        round: roundSentBy(undefined),
        steps: [SUPPORT],
        userId: BOB,
        userTeamIds: [],
        decision: PublicNoteApprovalDecision.Approve,
      }),
    ).toBeNull();
  });
});

describe("getPeopleToAsk: who a step asks", () => {
  test("the people it names and its teams' members, once each, in order", () => {
    expect(
      PublicNoteApproval.getPeopleToAsk({
        step: step("s", 1, {
          userIds: [BOB, CAROL],
          teamIds: [SUPPORT_TEAM, LEGAL_TEAM],
        }),
        teamMembers: {
          [SUPPORT_TEAM]: [DAVE, BOB],
          [LEGAL_TEAM]: [CAROL, DAVE],
        },
        round: roundSentBy(undefined),
      }),
    ).toEqual([BOB, CAROL, DAVE]);
  });

  test("never whoever sent the note, nor anyone who approved it already", () => {
    expect(
      PublicNoteApproval.getPeopleToAsk({
        step: step("s", 2, { userIds: [ALICE, BOB, CAROL] }),
        teamMembers: {},
        round: roundSentBy(ALICE, [{ stepId: "s1", userId: BOB }]),
      }),
    ).toEqual([CAROL]);
  });

  test("a team with no members, or one never read, asks nobody - and a team id that is an object's own key reaches no member list", () => {
    expect(
      PublicNoteApproval.getPeopleToAsk({
        step: step("s", 1, {
          teamIds: ["constructor", "__proto__", "toString", SUPPORT_TEAM],
        }),
        teamMembers: {},
        round: null,
      }),
    ).toEqual([]);
  });
});

describe("rounds: written, decided and read back", () => {
  test("a new round says who sent it and when, and nothing it does not ask for", () => {
    expect(
      PublicNoteApproval.startRound({
        now: NOW,
        submittedByUserId: ALICE,
        isEdit: false,
      }),
    ).toEqual({
      submittedAt: NOW.toISOString(),
      submittedByUserId: ALICE,
      isEdit: false,
      approvals: [],
    });

    expect(
      PublicNoteApproval.startRound({ now: NOW, isEdit: false }),
    ).toEqual({ submittedAt: NOW.toISOString(), isEdit: false, approvals: [] });
  });

  test("an edit keeps its notify request and what came before; a new note keeps its chosen time", () => {
    const before: PublicNoteApprovalRound = {
      ...roundSentBy(BOB),
      before: { status: null, round: null },
    };

    const edit: PublicNoteApprovalRound = PublicNoteApproval.startRound({
      now: NOW,
      submittedByUserId: ALICE,
      isEdit: true,
      notifySubscribersOfEdit: true,
      keepPostedAt: true,
      before: { status: PublicNoteApprovalStatus.Approved, round: before },
    });

    expect(edit.notifySubscribersOfEdit).toBe(true);
    // An edit takes the note's time from the note it edits.
    expect(edit.keepPostedAt).toBeUndefined();
    expect(edit.before?.status).toBe(PublicNoteApprovalStatus.Approved);
    // Only one level is kept: what came before has no "before" of its own.
    expect(edit.before?.round?.before).toBeUndefined();
    expect(edit.before?.round?.submittedByUserId).toBe(BOB);

    const note: PublicNoteApprovalRound = PublicNoteApproval.startRound({
      now: NOW,
      isEdit: false,
      notifySubscribersOfEdit: true,
      keepPostedAt: true,
      before: { status: null, round: null },
    });

    expect(note.keepPostedAt).toBe(true);
    expect(note.notifySubscribersOfEdit).toBeUndefined();
    expect(note.before).toBeUndefined();
  });

  test("an approval is added to a copy of the round, with its comment cleaned, and the last one publishes", () => {
    const round: PublicNoteApprovalRound = {
      ...roundSentBy(ALICE),
      rejection: { userId: CAROL, at: NOW.toISOString(), reason: "old" },
    };

    const approved: PublicNoteApprovalRound = PublicNoteApproval.recordApproval(
      {
        round,
        step: LEGAL,
        userId: CAROL,
        now: LATER,
        comment: "   Looks good   ",
        isFinal: true,
      },
    );

    expect(approved.approvals).toEqual([
      {
        stepId: LEGAL.id,
        stepName: "Legal",
        userId: CAROL,
        at: LATER.toISOString(),
        comment: "Looks good",
      },
    ]);
    expect(approved.publishedAt).toBe(LATER.toISOString());
    expect(approved.rejection).toBeUndefined();

    // The round it was handed is as it was.
    expect(round.approvals).toEqual([]);
    expect(round.rejection?.reason).toBe("old");

    const notFinal: PublicNoteApprovalRound = PublicNoteApproval.recordApproval(
      {
        round: roundSentBy(ALICE),
        step: SUPPORT,
        userId: BOB,
        now: LATER,
        comment: "   ",
        isFinal: false,
      },
    );

    expect(notFinal.publishedAt).toBeUndefined();
    expect(notFinal.approvals[0]!.comment).toBeUndefined();
    expect(notFinal.approvals[0]!.stepName).toBeUndefined();
  });

  test("a rejection names who, when, the step and the reason, cleaned", () => {
    const rejected: PublicNoteApprovalRound =
      PublicNoteApproval.recordRejection({
        round: roundSentBy(ALICE),
        step: LEGAL,
        userId: CAROL,
        now: LATER,
        reason: "  Do not name the vendor.  ",
      });

    expect(rejected.rejection).toEqual({
      userId: CAROL,
      at: LATER.toISOString(),
      reason: "Do not name the vendor.",
      stepId: LEGAL.id,
      stepName: "Legal",
    });

    const noStep: PublicNoteApprovalRound = PublicNoteApproval.recordRejection({
      round: null,
      step: null,
      userId: CAROL,
      now: LATER,
      reason: "No",
    });

    expect(noStep.rejection?.stepId).toBeUndefined();
    expect(noStep.submittedAt).toBe(LATER.toISOString());
  });

  test("cleanText trims, stops at the limit, and reads anything else as none", () => {
    expect(PublicNoteApproval.cleanText("  a  ")).toBe("a");
    expect(
      PublicNoteApproval.cleanText(
        "x".repeat(PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH + 50),
      ),
    ).toHaveLength(PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH);

    for (const value of [undefined, null, 42, {}, [], true]) {
      expect(PublicNoteApproval.cleanText(value)).toBe("");
    }
  });

  test("a round survives being stored and read back", () => {
    const round: PublicNoteApprovalRound = PublicNoteApproval.recordApproval({
      round: PublicNoteApproval.startRound({
        now: NOW,
        submittedByUserId: ALICE,
        isEdit: true,
        notifySubscribersOfEdit: true,
        before: {
          status: PublicNoteApprovalStatus.Approved,
          round: roundSentBy(DAVE),
        },
      }),
      step: SUPPORT,
      userId: BOB,
      now: LATER,
      comment: "ok",
      isFinal: true,
    });

    expect(
      PublicNoteApproval.readRound(
        JSON.parse(JSON.stringify(PublicNoteApproval.toJSON(round))),
      ),
    ).toEqual(round);
  });

  test("a stored value that is no round reads as none", () => {
    for (const value of [
      undefined,
      null,
      "round",
      42,
      [],
      {},
      { submittedAt: "" },
      { submittedAt: 7 },
    ]) {
      expect(PublicNoteApproval.readRound(value)).toBeNull();
    }
  });

  test("only the parts of a stored round that are what they say they are are read", () => {
    const round: PublicNoteApprovalRound | null = PublicNoteApproval.readRound({
      submittedAt: NOW.toISOString(),
      submittedByUserId: 12,
      isEdit: "yes",
      notifySubscribersOfEdit: "true",
      keepPostedAt: 1,
      approvals: [
        { stepId: "s1", userId: BOB, at: NOW.toISOString() },
        { stepId: "", userId: BOB, at: NOW.toISOString() },
        { stepId: "s2", userId: 5, at: NOW.toISOString() },
        { stepId: "s3", userId: CAROL },
        "approval",
        null,
      ],
      rejection: { userId: CAROL, at: NOW.toISOString(), reason: 5 },
      before: {
        status: "Nope",
        round: {
          submittedAt: NOW.toISOString(),
          isEdit: false,
          approvals: [],
          before: { status: "Approved", round: null },
        },
      },
    });

    expect(round).toEqual({
      submittedAt: NOW.toISOString(),
      isEdit: false,
      approvals: [{ stepId: "s1", userId: BOB, at: NOW.toISOString() }],
      before: {
        status: null,
        round: {
          submittedAt: NOW.toISOString(),
          isEdit: false,
          approvals: [],
        },
      },
    });
  });

  test("isStatus knows the three statuses and nothing else", () => {
    for (const status of Object.values(PublicNoteApprovalStatus)) {
      expect(PublicNoteApproval.isStatus(status)).toBe(true);
    }

    for (const value of ["", "Published", null, undefined, 1, {}]) {
      expect(PublicNoteApproval.isStatus(value)).toBe(false);
    }
  });
});
