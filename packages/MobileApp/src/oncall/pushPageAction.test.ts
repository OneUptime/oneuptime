import { describe, expect, test } from "@jest/globals";
import type { OnCallPageRecordType } from "../api/onCallPassOn";
import { PASS_ON_TEXT } from "./passOn";
import { OBSERVER_PAGE_TEXT } from "./observerPage";
import {
  PUSH_PAGE_TEXT,
  getPushPageAnswer,
  getPushPageRecordWord,
  isPushPageActionRequest,
  type PushPageAnswer,
  type PushPageRecordState,
} from "./pushPageAction";

/*
 * Acknowledge and Escalate tapped under a page's push, answered on the
 * record's screen with what it knows once it opens: the record's state, and
 * the reader's open pages about it. Never a guess - when the record was
 * already taken, resolved, or the reader is not paged about it any more, the
 * screen says so instead of doing something else.
 */

function state(overrides: Partial<PushPageRecordState>): PushPageRecordState {
  return {
    recordType: "incident",
    isResolved: false,
    isAcknowledged: false,
    canAcknowledge: true,
    hasOpenPages: true,
    isPageAgain: false,
    pagesKnown: true,
    ...overrides,
  };
}

describe("Acknowledge", () => {
  test("a record nobody has taken is acknowledged, as its own button does", () => {
    expect(getPushPageAnswer("acknowledge", state({}))).toEqual({
      kind: "acknowledge",
    });
  });

  test("it does not wait on the reader's pages: a page from an older server, or none at all, still acknowledges", () => {
    expect(
      getPushPageAnswer(
        "acknowledge",
        state({ pagesKnown: false, hasOpenPages: false }),
      ),
    ).toEqual({ kind: "acknowledge" });
  });

  test("a page again - the record acknowledged all along - is answered with Acknowledge again", () => {
    expect(
      getPushPageAnswer(
        "acknowledge",
        state({ isAcknowledged: true, isPageAgain: true }),
      ),
    ).toEqual({ kind: "acknowledgeAgain" });
  });

  test("a record somebody acknowledged since says so, and does nothing", () => {
    expect(
      getPushPageAnswer("acknowledge", state({ isAcknowledged: true })),
    ).toEqual({
      kind: "explain",
      title: "Already acknowledged",
      message:
        "This incident was already acknowledged, and you are not being paged about it.",
    });
  });

  test("a resolved record says so - before anything else, a page again included", () => {
    expect(
      getPushPageAnswer(
        "acknowledge",
        state({ isResolved: true, isAcknowledged: true, isPageAgain: true }),
      ),
    ).toEqual({
      kind: "explain",
      title: PUSH_PAGE_TEXT.alreadyResolvedTitle,
      message: "This incident is resolved, so there is nothing to acknowledge.",
    });
  });

  test("a project with no acknowledged state says it cannot", () => {
    expect(
      getPushPageAnswer("acknowledge", state({ canAcknowledge: false })),
    ).toEqual({
      kind: "explain",
      title: PUSH_PAGE_TEXT.couldNotAcknowledgeTitle,
      message: "This project has no acknowledged state for this incident.",
    });
  });
});

describe("Escalate", () => {
  test("a reader being paged about it is asked first, as the screen's own Escalate asks", () => {
    expect(getPushPageAnswer("escalate", state({}))).toEqual({
      kind: "askToEscalate",
    });
    expect(
      getPushPageAnswer(
        "escalate",
        state({ isAcknowledged: true, isPageAgain: true }),
      ),
    ).toEqual({ kind: "askToEscalate" });
  });

  test("a reader not paged about it any more is told there is nothing to escalate, in the screen's own words", () => {
    const answer: PushPageAnswer = getPushPageAnswer(
      "escalate",
      state({ hasOpenPages: false, isAcknowledged: true }),
    );

    expect(answer).toEqual({
      kind: "explain",
      title: PASS_ON_TEXT.notDoneTitle,
      message: "You are not being paged about this right now.",
    });
    expect(PASS_ON_TEXT.notDoneTitle).toBe("Nothing to escalate");
  });

  test("a resolved record has nothing to escalate", () => {
    expect(
      getPushPageAnswer("escalate", state({ isResolved: true })),
    ).toMatchObject({ kind: "explain", title: "Nothing to escalate" });
  });

  test("when the server could not say what the reader's pages are, it says that - never 'nothing to escalate'", () => {
    expect(
      getPushPageAnswer(
        "escalate",
        state({ pagesKnown: false, hasOpenPages: false }),
      ),
    ).toEqual({
      kind: "explain",
      title: "Could not escalate",
      message:
        "OneUptime could not check whether you are being paged about this right now. Pull down to refresh, then try again.",
    });
  });
});

describe("the record's word in a sentence", () => {
  test.each([
    ["incident", "incident"],
    ["alert", "alert"],
    ["incident-episode", "episode"],
    ["alert-episode", "episode"],
  ] as Array<[OnCallPageRecordType, string]>)(
    "%s is an %s",
    (recordType: OnCallPageRecordType, word: string) => {
      expect(getPushPageRecordWord(recordType)).toBe(word);
      const answer: PushPageAnswer = getPushPageAnswer(
        "acknowledge",
        state({ recordType, isAcknowledged: true }),
      );
      expect(answer.kind === "explain" ? answer.message : "").toContain(
        `This ${word} was already acknowledged`,
      );
    },
  );
});

/*
 * "I've seen it" under an observer's page: the reader is kept informed while
 * others respond, and their page is marked seen - never the record's own
 * Acknowledge, whatever state the record is in.
 */
describe("I've seen it", () => {
  const OPEN_OBSERVER: Partial<PushPageRecordState> = {
    // Paged only as an observer: no responder's page of their own.
    hasOpenPages: false,
    observerPages: { hasOpenPages: true, known: true },
  };

  test("an open observer's page is marked seen", () => {
    expect(getPushPageAnswer("seen", state(OPEN_OBSERVER))).toEqual({
      kind: "markSeen",
    });
  });

  test("never the record's Acknowledge - on a record nobody has taken, or one acknowledged long ago", () => {
    for (const overrides of [
      {},
      { isAcknowledged: true },
      { isAcknowledged: true, isPageAgain: true },
      { canAcknowledge: false },
      // A responder's page of their own, too: this action answers the observer's.
      { hasOpenPages: true },
    ] as Array<Partial<PushPageRecordState>>) {
      const answer: PushPageAnswer = getPushPageAnswer(
        "seen",
        state({ ...OPEN_OBSERVER, ...overrides }),
      );

      expect(answer).toEqual({ kind: "markSeen" });
    }
  });

  test("a page somebody it reached said they had seen - or the reader did already - says so, in the email's words", () => {
    expect(
      getPushPageAnswer(
        "seen",
        state({ observerPages: { hasOpenPages: false, known: true } }),
      ),
    ).toEqual({
      kind: "explain",
      title: "Already marked as seen",
      message: "This page has already been marked as seen.",
    });
  });

  test("a resolved record says so first: its observers' pages are over", () => {
    expect(
      getPushPageAnswer("seen", state({ ...OPEN_OBSERVER, isResolved: true })),
    ).toEqual({
      kind: "explain",
      title: OBSERVER_PAGE_TEXT.alreadyResolvedTitle,
      message:
        "This incident is resolved, so there is nothing to mark as seen.",
    });
  });

  test.each([
    ["alert", "This alert is resolved"],
    ["incident-episode", "This incident episode is resolved"],
    ["alert-episode", "This alert episode is resolved"],
  ] as Array<[OnCallPageRecordType, string]>)(
    "a resolved %s is named as the server names it",
    (recordType: OnCallPageRecordType, opening: string) => {
      const answer: PushPageAnswer = getPushPageAnswer(
        "seen",
        state({ ...OPEN_OBSERVER, recordType, isResolved: true }),
      );

      expect(answer.kind).toBe("explain");
      expect((answer as { message: string }).message.startsWith(opening)).toBe(
        true,
      );
    },
  );

  test("when the server could not say - an older one, no signal - it says that, and marks nothing", () => {
    for (const observerPages of [
      undefined,
      { hasOpenPages: false, known: false },
      { hasOpenPages: true, known: false },
    ]) {
      expect(getPushPageAnswer("seen", state({ observerPages }))).toEqual({
        kind: "explain",
        title: "Could not mark as seen",
        message: OBSERVER_PAGE_TEXT.couldNotCheck,
      });
    }
  });

  test("a responder's Acknowledge on the same screen still acknowledges, as it always did", () => {
    expect(getPushPageAnswer("acknowledge", state(OPEN_OBSERVER))).toEqual({
      kind: "acknowledge",
    });
  });
});

describe("what a screen's params must hold to be an action", () => {
  test("a kind it knows and the tap's id", () => {
    expect(isPushPageActionRequest({ kind: "acknowledge", id: "n-1:A" })).toBe(
      true,
    );
    expect(isPushPageActionRequest({ kind: "escalate", id: "n-1:E" })).toBe(
      true,
    );
    expect(isPushPageActionRequest({ kind: "seen", id: "n-1:S" })).toBe(true);
  });

  test("anything else is no action", () => {
    for (const value of [
      undefined,
      null,
      "acknowledge",
      { kind: "acknowledge" },
      { kind: "acknowledge", id: "" },
      { kind: "acknowledge", id: 7 },
      { kind: "resolve", id: "n-1" },
      { kind: "ACKNOWLEDGE", id: "n-1" },
      { kind: "SEEN", id: "n-1" },
      { kind: "seen" },
      [],
    ]) {
      expect(isPushPageActionRequest(value)).toBe(false);
    }
  });
});
