import { describe, expect, test } from "@jest/globals";
import type { ResponseAction } from "../components/ResponseDetailLayout";
import {
  getPagedResponseActions,
  isObserverOnly,
  isPagedAgain,
  type PagedActionsInput,
} from "./pagedActions";

/*
 * The buttons on an incident, an alert or an episode, for the person paged.
 * One rule for the four screens: Acknowledge again while a page again waits,
 * the record's own Acknowledge while nobody has, Resolve until it is
 * resolved, Escalate for somebody paged about it - and one filled button.
 */

function action(label: string, primary?: boolean): ResponseAction {
  return {
    label,
    accessibilityLabel: label,
    onPress: (): void => {
      // Not pressed here.
    },
    ...(primary === undefined ? {} : { primary }),
  };
}

const ACKNOWLEDGE: ResponseAction = action("Acknowledge", true);
const RESOLVE: ResponseAction = action("Resolve");
const ESCALATE: ResponseAction = action("Escalate");
const ACKNOWLEDGE_AGAIN: ResponseAction = action("Acknowledge again", true);
const SEEN: ResponseAction = action("I've seen it", true);

function input(overrides: Partial<PagedActionsInput>): PagedActionsInput {
  return {
    isResolved: false,
    isAcknowledged: false,
    acknowledge: ACKNOWLEDGE,
    resolve: RESOLVE,
    escalate: null,
    acknowledgeAgain: null,
    ...overrides,
  };
}

// "Acknowledge*" for a filled button, the label alone for an outlined one.
function drawn(actions: ResponseAction[]): string[] {
  return actions.map((item: ResponseAction): string => {
    return item.primary ? `${item.label}*` : item.label;
  });
}

describe("nobody has taken it yet", () => {
  test("Acknowledge, filled, then Resolve", () => {
    expect(drawn(getPagedResponseActions(input({})))).toEqual([
      "Acknowledge*",
      "Resolve",
    ]);
  });

  test("the reader is being paged about it: Escalate after them", () => {
    expect(
      drawn(getPagedResponseActions(input({ escalate: ESCALATE }))),
    ).toEqual(["Acknowledge*", "Resolve", "Escalate"]);
  });

  test("a project with no acknowledged state: Resolve is the filled one", () => {
    expect(
      drawn(
        getPagedResponseActions(
          input({ acknowledge: null, escalate: ESCALATE }),
        ),
      ),
    ).toEqual(["Resolve*", "Escalate"]);
  });
});

describe("somebody has acknowledged it", () => {
  test("Resolve, filled - no Acknowledge, which would move it back up the list", () => {
    expect(
      drawn(getPagedResponseActions(input({ isAcknowledged: true }))),
    ).toEqual(["Resolve*"]);
  });

  test("an open page that is not a page again offers no Escalate on an acknowledged record", () => {
    expect(
      drawn(
        getPagedResponseActions(
          input({ isAcknowledged: true, escalate: ESCALATE }),
        ),
      ),
    ).toEqual(["Resolve*"]);
  });

  test("the reader is paged again: Acknowledge again first and filled, then Resolve and Escalate", () => {
    const pagedAgain: PagedActionsInput = input({
      isAcknowledged: true,
      escalate: ESCALATE,
      acknowledgeAgain: ACKNOWLEDGE_AGAIN,
    });

    expect(isPagedAgain(pagedAgain)).toBe(true);
    expect(drawn(getPagedResponseActions(pagedAgain))).toEqual([
      "Acknowledge again*",
      "Resolve",
      "Escalate",
    ]);
  });

  test("one filled button at a time, whatever the page again's own action says", () => {
    const actions: ResponseAction[] = getPagedResponseActions(
      input({
        isAcknowledged: true,
        escalate: { ...ESCALATE, primary: true },
        acknowledgeAgain: { ...ACKNOWLEDGE_AGAIN, primary: false },
        resolve: { ...RESOLVE, primary: true },
      }),
    );

    expect(
      actions.filter((item: ResponseAction) => {
        return item.primary;
      }),
    ).toHaveLength(1);
    // Acknowledge again is filled; Resolve and Escalate are not.
    expect(drawn(actions)).toEqual([
      "Acknowledge again*",
      "Resolve",
      "Escalate",
    ]);
  });
});

describe("a page again only where it means something", () => {
  test("on a record nobody has acknowledged, the record's own Acknowledge is the answer", () => {
    const notAcknowledged: PagedActionsInput = input({
      acknowledgeAgain: ACKNOWLEDGE_AGAIN,
      escalate: ESCALATE,
    });

    expect(isPagedAgain(notAcknowledged)).toBe(false);
    expect(drawn(getPagedResponseActions(notAcknowledged))).toEqual([
      "Acknowledge*",
      "Resolve",
      "Escalate",
    ]);
  });

  test("a resolved record has no buttons at all, and is not paged again", () => {
    const resolved: PagedActionsInput = input({
      isResolved: true,
      isAcknowledged: true,
      escalate: ESCALATE,
      acknowledgeAgain: ACKNOWLEDGE_AGAIN,
    });

    expect(isPagedAgain(resolved)).toBe(false);
    expect(getPagedResponseActions(resolved)).toEqual([]);
  });

  test("a project with no resolved state still answers the page again", () => {
    expect(
      drawn(
        getPagedResponseActions(
          input({
            isAcknowledged: true,
            resolve: null,
            escalate: ESCALATE,
            acknowledgeAgain: ACKNOWLEDGE_AGAIN,
          }),
        ),
      ),
    ).toEqual(["Acknowledge again*", "Escalate"]);
  });
});

/*
 * Paged about it only as an observer (oncall/observerPage.ts): kept informed
 * while others respond. "I've seen it" is the answer, first and filled, and
 * the record's own Acknowledge - which would take the record on - is never
 * offered for it.
 */
describe("the reader is paged about it only as an observer", () => {
  test("I've seen it, filled, then Resolve - and no Acknowledge on a record nobody has taken", () => {
    const given: PagedActionsInput = input({ seen: SEEN });

    expect(isObserverOnly(given)).toBe(true);
    expect(drawn(getPagedResponseActions(given))).toEqual([
      "I've seen it*",
      "Resolve",
    ]);
  });

  test("on a record the responders acknowledged, the same: I've seen it, then Resolve", () => {
    expect(
      drawn(
        getPagedResponseActions(input({ isAcknowledged: true, seen: SEEN })),
      ),
    ).toEqual(["I've seen it*", "Resolve"]);
  });

  test("I've seen it is filled however the screen handed it over, and Resolve never is", () => {
    expect(
      drawn(
        getPagedResponseActions(
          input({ seen: action("I've seen it", false), resolve: RESOLVE }),
        ),
      ),
    ).toEqual(["I've seen it*", "Resolve"]);
  });

  test("a project with no resolved state: I've seen it alone", () => {
    expect(
      drawn(getPagedResponseActions(input({ resolve: null, seen: SEEN }))),
    ).toEqual(["I've seen it*"]);
  });

  test("a resolved record has no buttons at all: the page is over", () => {
    const given: PagedActionsInput = input({ isResolved: true, seen: SEEN });

    expect(isObserverOnly(given)).toBe(false);
    expect(getPagedResponseActions(given)).toEqual([]);
  });

  test("once they have said they have seen it, the screen is as it is for anybody", () => {
    const given: PagedActionsInput = input({ seen: null });

    expect(isObserverOnly(given)).toBe(false);
    expect(drawn(getPagedResponseActions(given))).toEqual([
      "Acknowledge*",
      "Resolve",
    ]);
  });
});

describe("the reader is paged about it both as a responder and as an observer", () => {
  test("their own page as a responder leads, as it always did; I've seen it sits before Escalate, outlined", () => {
    const given: PagedActionsInput = input({ escalate: ESCALATE, seen: SEEN });

    expect(isObserverOnly(given)).toBe(false);
    expect(drawn(getPagedResponseActions(given))).toEqual([
      "Acknowledge*",
      "Resolve",
      "I've seen it",
      "Escalate",
    ]);
  });

  test("paged again as a responder: Acknowledge again first, then the rest", () => {
    const given: PagedActionsInput = input({
      isAcknowledged: true,
      acknowledgeAgain: ACKNOWLEDGE_AGAIN,
      escalate: ESCALATE,
      seen: SEEN,
    });

    expect(isObserverOnly(given)).toBe(false);
    expect(drawn(getPagedResponseActions(given))).toEqual([
      "Acknowledge again*",
      "Resolve",
      "I've seen it",
      "Escalate",
    ]);
  });
});

describe("the actions keep what each screen gave them", () => {
  test("labels, icons and presses pass through untouched", () => {
    const onPress: () => void = (): void => {
      // The screen's own.
    };
    const actions: ResponseAction[] = getPagedResponseActions(
      input({
        acknowledge: {
          ...ACKNOWLEDGE,
          icon: "eye-outline",
          accessibilityLabel: "Acknowledge incident",
          busyAccessibilityLabel: "Acknowledging",
          onPress,
        },
      }),
    );

    expect(actions[0]).toEqual({
      label: "Acknowledge",
      accessibilityLabel: "Acknowledge incident",
      busyAccessibilityLabel: "Acknowledging",
      icon: "eye-outline",
      primary: true,
      onPress,
    });
  });
});
