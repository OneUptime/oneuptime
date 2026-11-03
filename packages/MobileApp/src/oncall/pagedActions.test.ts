import { describe, expect, test } from "@jest/globals";
import type { ResponseAction } from "../components/ResponseDetailLayout";
import {
  getPagedResponseActions,
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
