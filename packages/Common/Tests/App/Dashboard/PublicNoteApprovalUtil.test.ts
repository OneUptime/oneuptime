import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import {
  approveNote,
  fetchApprovalPolicy,
  fetchApprovalSummaries,
  getApprovalActions,
  getApprovalBadge,
  getApproverNames,
  getNoteApprovalState,
  getNoteIdsToDescribe,
  getStepTemplate,
  isNotePublished,
  PublicNoteApprovalCopy,
  PublicNoteApprovalNoteSummary,
  rejectNote,
  resubmitNote,
  withdrawNoteEdit,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/PublicNoteApproval/PublicNoteApprovalUtil";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import {
  PublicNoteApprovalState,
  PublicNoteApprovalStatus,
} from "../../../Types/StatusPage/PublicNoteApproval";
import API from "../../../UI/Utils/API/API";

/*
 * What the notes feed shows about a public note's approval (issue #5720),
 * and the calls its buttons make. The server decides who may do what; the
 * feed only draws it - but it must never offer what the note's state does
 * not allow, and never call a note published that is not.
 */

const NOTE_ID: string = "44444444-4444-4444-8444-444444444444";
const OTHER_ID: string = "55555555-5555-4555-8555-555555555555";

function summary(
  overrides: Partial<PublicNoteApprovalNoteSummary> = {},
): PublicNoteApprovalNoteSummary {
  return {
    noteId: NOTE_ID,
    state: PublicNoteApprovalState.WaitingForApproval,
    isEdit: false,
    approvals: [],
    canApprove: true,
    canReject: true,
    ...overrides,
  };
}

const ALL_STATES: Array<PublicNoteApprovalState> = Object.values(
  PublicNoteApprovalState,
);

afterEach(() => {
  jest.restoreAllMocks();
});

describe("where a note stands", () => {
  test("a note as the feed loads it", () => {
    expect(getNoteApprovalState({})).toBe(PublicNoteApprovalState.Published);
    expect(
      getNoteApprovalState({
        isPublished: false,
        approvalStatus: PublicNoteApprovalStatus.WaitingForApproval,
      }),
    ).toBe(PublicNoteApprovalState.WaitingForApproval);
    expect(
      getNoteApprovalState({
        isPublished: false,
        approvalStatus: PublicNoteApprovalStatus.Rejected,
      }),
    ).toBe(PublicNoteApprovalState.Rejected);
    expect(
      getNoteApprovalState({
        isPublished: true,
        approvalStatus: PublicNoteApprovalStatus.WaitingForApproval,
      }),
    ).toBe(PublicNoteApprovalState.EditWaitingForApproval);
  });

  test("only a note waiting for approval, or rejected, is off status pages", () => {
    expect(
      ALL_STATES.filter((state: PublicNoteApprovalState) => {
        return !isNotePublished(state);
      }).sort(),
    ).toEqual(
      [
        PublicNoteApprovalState.WaitingForApproval,
        PublicNoteApprovalState.Rejected,
      ].sort(),
    );
  });
});

describe("getApprovalBadge", () => {
  test("each state that waits or was rejected says so", () => {
    expect(
      getApprovalBadge(PublicNoteApprovalState.WaitingForApproval),
    ).toEqual({ label: PublicNoteApprovalCopy.waiting, tone: "waiting" });
    expect(getApprovalBadge(PublicNoteApprovalState.Rejected)).toEqual({
      label: PublicNoteApprovalCopy.rejected,
      tone: "rejected",
    });
    expect(
      getApprovalBadge(PublicNoteApprovalState.EditWaitingForApproval),
    ).toEqual({ label: PublicNoteApprovalCopy.editWaiting, tone: "waiting" });
    expect(getApprovalBadge(PublicNoteApprovalState.EditRejected)).toEqual({
      label: PublicNoteApprovalCopy.editRejected,
      tone: "rejected",
    });
  });

  test("a published note carries Approved only when somebody approved it", () => {
    expect(getApprovalBadge(PublicNoteApprovalState.Published)).toBeNull();
    expect(
      getApprovalBadge(PublicNoteApprovalState.Published, summary()),
    ).toBeNull();
    expect(
      getApprovalBadge(
        PublicNoteApprovalState.Published,
        summary({ approvals: [{ by: "Bob", at: "2026-11-07T10:00:00Z" }] }),
      ),
    ).toEqual({ label: PublicNoteApprovalCopy.approved, tone: "approved" });
  });
});

describe("the step a note waits for", () => {
  test("a single step needs no step number", () => {
    expect(getStepTemplate(undefined)).toBeNull();
    expect(
      getStepTemplate({
        number: 1,
        count: 1,
        name: "Support",
        isFinal: true,
        isAskedAgain: false,
        people: [],
        teams: [],
      }),
    ).toBeNull();
  });

  test("several: which one, of how many, and its name when it has one", () => {
    expect(
      getStepTemplate({
        number: 2,
        count: 3,
        name: "Legal",
        isFinal: false,
        isAskedAgain: false,
        people: [],
        teams: [],
      }),
    ).toEqual({
      template: PublicNoteApprovalCopy.stepOfNamed,
      values: { number: "2", count: "3", name: "Legal" },
    });
    expect(
      getStepTemplate({
        number: 2,
        count: 3,
        isFinal: false,
        isAskedAgain: false,
        people: [],
        teams: [],
      }),
    ).toEqual({
      template: PublicNoteApprovalCopy.stepOf,
      values: { number: "2", count: "3" },
    });
  });

  test("its approvers, people first", () => {
    expect(
      getApproverNames({ people: ["Alice", ""], teams: ["Legal team"] }),
    ).toEqual(["Alice", "Legal team"]);
    expect(getApproverNames(undefined)).toEqual([]);
  });
});

describe("getApprovalActions", () => {
  test("Approve and Reject only on a note that waits, and only as the server allows", () => {
    for (const state of ALL_STATES) {
      const actions: ReturnType<typeof getApprovalActions> = getApprovalActions(
        {
          state,
          summary: summary(),
          isRequired: true,
          canEdit: true,
        },
      );
      const waits: boolean =
        state === PublicNoteApprovalState.WaitingForApproval ||
        state === PublicNoteApprovalState.EditWaitingForApproval;

      expect([state, actions.canApprove, actions.canReject]).toEqual([
        state,
        waits,
        waits,
      ]);
    }

    const refused: ReturnType<typeof getApprovalActions> = getApprovalActions({
      state: PublicNoteApprovalState.WaitingForApproval,
      summary: summary({ canApprove: false, canReject: false }),
      isRequired: true,
      canEdit: true,
    });
    expect(refused.canApprove).toBe(false);
    expect(refused.canReject).toBe(false);

    // Before the server has said, nothing is offered.
    expect(
      getApprovalActions({
        state: PublicNoteApprovalState.WaitingForApproval,
        isRequired: true,
        canEdit: true,
      }).canApprove,
    ).toBe(false);
  });

  test("a rejected note can be sent again by whoever may edit it", () => {
    for (const state of [
      PublicNoteApprovalState.Rejected,
      PublicNoteApprovalState.EditRejected,
    ]) {
      expect(
        getApprovalActions({ state, isRequired: true, canEdit: true }),
      ).toMatchObject({
        canResubmit: true,
        resubmitLabel: PublicNoteApprovalCopy.sendAgain,
      });
      expect(
        getApprovalActions({ state, isRequired: true, canEdit: false })
          .canResubmit,
      ).toBe(false);
    }

    // A note still waiting is not sent again while approval is asked for.
    expect(
      getApprovalActions({
        state: PublicNoteApprovalState.WaitingForApproval,
        isRequired: true,
        canEdit: true,
      }).canResubmit,
    ).toBe(false);
  });

  test("once approval is off, a waiting note can be published now", () => {
    expect(
      getApprovalActions({
        state: PublicNoteApprovalState.WaitingForApproval,
        isRequired: false,
        canEdit: true,
      }),
    ).toMatchObject({
      canResubmit: true,
      resubmitLabel: PublicNoteApprovalCopy.publishNow,
    });
  });

  test("an edit waiting or rejected can be withdrawn by whoever may edit the note", () => {
    for (const state of ALL_STATES) {
      const hasEdit: boolean =
        state === PublicNoteApprovalState.EditWaitingForApproval ||
        state === PublicNoteApprovalState.EditRejected;

      expect([
        state,
        getApprovalActions({ state, isRequired: true, canEdit: true })
          .canWithdrawEdit,
        getApprovalActions({ state, isRequired: true, canEdit: false })
          .canWithdrawEdit,
      ]).toEqual([state, hasEdit, false]);
    }
  });

  test("says when approving publishes the note", () => {
    expect(
      getApprovalActions({
        state: PublicNoteApprovalState.WaitingForApproval,
        summary: summary({
          step: {
            number: 2,
            count: 2,
            isFinal: true,
            isAskedAgain: false,
            people: [],
            teams: [],
          },
        }),
        isRequired: true,
        canEdit: true,
      }).isApprovalFinal,
    ).toBe(true);
  });
});

describe("getNoteIdsToDescribe", () => {
  test("asks about notes with an approval, each once, and not about the rest", () => {
    expect(
      getNoteIdsToDescribe([
        {
          _id: NOTE_ID,
          isPublished: false,
          approvalStatus: PublicNoteApprovalStatus.WaitingForApproval,
        },
        {
          _id: NOTE_ID,
          isPublished: false,
          approvalStatus: PublicNoteApprovalStatus.WaitingForApproval,
        },
        // Published by an approval: its "Approved by" is asked about.
        {
          id: {
            toString: () => {
              return OTHER_ID;
            },
          },
          isPublished: true,
          approvalStatus: PublicNoteApprovalStatus.Approved,
        },
        // A note that never needed approval.
        { _id: "66666666-6666-4666-8666-666666666666", isPublished: true },
        // One with no id.
        { isPublished: false },
      ]),
    ).toEqual([NOTE_ID, OTHER_ID]);
  });
});

// What jest.spyOn(API, "post") hands back.
type PostSpy = SpyInstance<
  (...args: Parameters<typeof API.post>) => ReturnType<typeof API.post>
>;

describe("the calls", () => {
  function answer(data: JSONObject): PostSpy {
    return jest
      .spyOn(API, "post")
      .mockResolvedValue(new HTTPResponse(200, data, {}) as never);
  }

  function pathOf(call: Array<unknown>): string {
    return (call[0] as { url: { toString: () => string } }).url.toString();
  }

  test("each button posts to its note's route", async () => {
    const post: PostSpy = answer({});

    await approveNote({ apiPath: "/incident-public-note", noteId: NOTE_ID });
    await rejectNote({
      apiPath: "/incident-public-note",
      noteId: NOTE_ID,
      reason: "Wording.",
    });
    await resubmitNote({ apiPath: "/incident-public-note", noteId: NOTE_ID });
    await withdrawNoteEdit({
      apiPath: "/incident-public-note",
      noteId: NOTE_ID,
    });

    const calls: Array<Array<unknown>> = post.mock.calls as Array<
      Array<unknown>
    >;

    expect(pathOf(calls[0]!)).toContain(
      `/incident-public-note/${NOTE_ID}/approve`,
    );
    expect((calls[0]![0] as { data: JSONObject }).data).toEqual({
      comment: "",
    });
    expect(pathOf(calls[1]!)).toContain(
      `/incident-public-note/${NOTE_ID}/reject`,
    );
    expect((calls[1]![0] as { data: JSONObject }).data).toEqual({
      reason: "Wording.",
    });
    expect(pathOf(calls[2]!)).toContain(
      `/incident-public-note/${NOTE_ID}/resubmit`,
    );
    expect(pathOf(calls[3]!)).toContain(
      `/incident-public-note/${NOTE_ID}/discard-edit`,
    );
  });

  test("a refusal reaches the person as the server worded it", async () => {
    jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPErrorResponse(
          400,
          { message: "You sent this note, so somebody else approves it." },
          {},
        ) as never,
      );

    await expect(
      approveNote({ apiPath: "/incident-public-note", noteId: NOTE_ID }),
    ).rejects.toThrow("You sent this note, so somebody else approves it.");
  });

  test("summaries: none asked for, none fetched", async () => {
    const post: PostSpy = answer({ notes: [] });

    expect(await fetchApprovalSummaries("/incident-public-note", [])).toEqual(
      [],
    );
    expect(post).not.toHaveBeenCalled();

    await fetchApprovalSummaries("/incident-public-note", [NOTE_ID]);
    expect((post.mock.calls[0]![0] as { data: JSONObject }).data).toEqual({
      noteIds: [NOTE_ID],
    });
  });

  test("a policy answer that is not what it should be reads as not required", async () => {
    answer({ isRequired: "yes", steps: "none" });

    expect(await fetchApprovalPolicy("/incident-public-note")).toEqual({
      isRequired: false,
      steps: [],
    });
  });
});
