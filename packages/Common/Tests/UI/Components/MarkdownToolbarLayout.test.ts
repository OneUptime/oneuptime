import {
  MarkdownToolbarLayout,
  TOOLBAR_BUTTON_PX,
  TOOLBAR_DIVIDER_PX,
  TOOLBAR_GAP_PX,
  TOOLBAR_MIN_BUTTONS,
  TOOLBAR_SLACK_PX,
  countToolbarButtons,
  countVisibleGroups,
  fitMarkdownToolbar,
  getFullToolbarLayout,
  getToolbarLineWidth,
  isSameToolbarLayout,
} from "../../../UI/Components/Markdown.tsx/MarkdownToolbarLayout";
import { describe, expect, test } from "@jest/globals";

/*
 * The Markdown editor's toolbar keeps one line at any width: the buttons
 * that do not fit go, from the end, under More formatting; the Markdown /
 * Visual switch and Insert variable stay, until the switch has to make room
 * for the first group of buttons. These pin the arithmetic the editor uses
 * to decide that.
 */

// The editor's groups: text, headings, lists, links and media, blocks.
const GROUPS: Array<number> = [4, 3, 5, 3, 4];
// Without the Image button: a form open to the public.
const GROUPS_WITHOUT_IMAGE: Array<number> = [4, 3, 5, 2, 4];
const MODE_TOGGLE: number = 84;
const INSERT_VARIABLE: number = 140;

// The width a line of exactly these things takes, written out by hand.
function line(parts: Array<number>): number {
  return (
    parts.reduce((sum: number, part: number): number => {
      return sum + part;
    }, 0) +
    (parts.length - 1) * TOOLBAR_GAP_PX
  );
}

const B: number = TOOLBAR_BUTTON_PX;
const D: number = TOOLBAR_DIVIDER_PX;

function fit(
  availableWidth: number,
  options?: { groups?: Array<number>; variables?: boolean },
): MarkdownToolbarLayout {
  return fitMarkdownToolbar({
    availableWidth,
    groupSizes: options?.groups || GROUPS,
    modeToggleWidth: MODE_TOGGLE,
    variableButtonWidth: options?.variables ? INSERT_VARIABLE : 0,
  });
}

describe("the toolbar's sizes", () => {
  test("are the editor's: square w-8 buttons, gap-1, a w-px divider", () => {
    expect(TOOLBAR_BUTTON_PX).toBe(32);
    expect(TOOLBAR_GAP_PX).toBe(4);
    expect(TOOLBAR_DIVIDER_PX).toBe(1);
    expect(TOOLBAR_SLACK_PX).toBeGreaterThan(0);
    // The first group: Bold, Italic, Underline, Strikethrough.
    expect(TOOLBAR_MIN_BUTTONS).toBe(4);
  });

  test("count every button of every group", () => {
    expect(countToolbarButtons(GROUPS)).toBe(19);
    expect(countToolbarButtons(GROUPS_WITHOUT_IMAGE)).toBe(18);
    expect(countToolbarButtons([])).toBe(0);
    expect(countToolbarButtons([2, -1, 0, 3])).toBe(5);
  });

  test("count the groups the first buttons reach into", () => {
    expect(countVisibleGroups(GROUPS, 0)).toBe(0);
    expect(countVisibleGroups(GROUPS, 1)).toBe(1);
    expect(countVisibleGroups(GROUPS, 4)).toBe(1);
    expect(countVisibleGroups(GROUPS, 5)).toBe(2);
    expect(countVisibleGroups(GROUPS, 7)).toBe(2);
    expect(countVisibleGroups(GROUPS, 8)).toBe(3);
    expect(countVisibleGroups(GROUPS, 19)).toBe(5);
    expect(countVisibleGroups(GROUPS, 40)).toBe(5);
    // An empty group is never reached into.
    expect(countVisibleGroups([2, 0, 2], 3)).toBe(2);
  });
});

describe("the width of a line", () => {
  test("is its buttons, a divider between groups, and a gap between each", () => {
    expect(
      getToolbarLineWidth({
        groupSizes: GROUPS,
        visibleButtonCount: 4,
        hasMoreMenu: false,
        modeToggleWidth: 0,
        variableButtonWidth: 0,
      }),
    ).toBe(line([B, B, B, B]));

    expect(
      getToolbarLineWidth({
        groupSizes: GROUPS,
        visibleButtonCount: 6,
        hasMoreMenu: false,
        modeToggleWidth: 0,
        variableButtonWidth: 0,
      }),
    ).toBe(line([B, B, B, B, D, B, B]));
  });

  test("adds the More formatting button, the switch after its divider, and Insert variable", () => {
    expect(
      getToolbarLineWidth({
        groupSizes: GROUPS,
        visibleButtonCount: 5,
        hasMoreMenu: true,
        modeToggleWidth: MODE_TOGGLE,
        variableButtonWidth: INSERT_VARIABLE,
      }),
    ).toBe(line([B, B, B, B, D, B, B, D, MODE_TOGGLE, INSERT_VARIABLE]));
  });

  test("is the menu button alone when no button fits", () => {
    expect(
      getToolbarLineWidth({
        groupSizes: GROUPS,
        visibleButtonCount: 0,
        hasMoreMenu: true,
        modeToggleWidth: 0,
        variableButtonWidth: 0,
      }),
    ).toBe(B);
  });

  test("of the whole toolbar, is what the editor needs to show it all", () => {
    const everything: number = getToolbarLineWidth({
      groupSizes: GROUPS,
      visibleButtonCount: 19,
      hasMoreMenu: false,
      modeToggleWidth: MODE_TOGGLE,
      variableButtonWidth: 0,
    });

    // 19 buttons, 4 dividers between the 5 groups, the switch's divider.
    expect(everything).toBe(
      19 * B + 5 * D + MODE_TOGGLE + (19 + 5 + 1 - 1) * TOOLBAR_GAP_PX,
    );
  });
});

describe("fitting the toolbar", () => {
  const everything: number = getToolbarLineWidth({
    groupSizes: GROUPS,
    visibleButtonCount: 19,
    hasMoreMenu: false,
    modeToggleWidth: MODE_TOGGLE,
    variableButtonWidth: 0,
  });

  test("puts everything on the line when it fits, with no menu", () => {
    expect(fit(everything + TOOLBAR_SLACK_PX)).toEqual({
      visibleButtonCount: 19,
      isModeToggleInBar: true,
      hasMoreMenu: false,
    });
    expect(fit(2000)).toEqual(getFullToolbarLayout(GROUPS));
  });

  test("keeps the slack: a line that fits only by a hair puts the last button away", () => {
    const layout: MarkdownToolbarLayout = fit(
      everything + TOOLBAR_SLACK_PX - 1,
    );

    expect(layout.visibleButtonCount).toBeLessThan(19);
    expect(layout.hasMoreMenu).toBe(true);
    expect(layout.isModeToggleInBar).toBe(true);
  });

  test("moves buttons from the end into the menu, counting the menu button", () => {
    for (let width: number = 200; width <= everything + 20; width += 7) {
      const layout: MarkdownToolbarLayout = fit(width);

      if (layout.hasMoreMenu) {
        // What it chose fits ...
        expect(
          getToolbarLineWidth({
            groupSizes: GROUPS,
            visibleButtonCount: layout.visibleButtonCount,
            hasMoreMenu: true,
            modeToggleWidth: layout.isModeToggleInBar ? MODE_TOGGLE : 0,
            variableButtonWidth: 0,
          }),
        ).toBeLessThanOrEqual(width - TOOLBAR_SLACK_PX);

        // ... and one more button would not.
        if (layout.visibleButtonCount < 19) {
          expect(
            getToolbarLineWidth({
              groupSizes: GROUPS,
              visibleButtonCount: layout.visibleButtonCount + 1,
              hasMoreMenu: layout.visibleButtonCount + 1 < 19,
              modeToggleWidth: layout.isModeToggleInBar ? MODE_TOGGLE : 0,
              variableButtonWidth: 0,
            }),
          ).toBeGreaterThan(width - TOOLBAR_SLACK_PX);
        }
      }
    }
  });

  /*
   * As the line gets wider the switch comes back onto it and stays, and
   * while it stays where it is the buttons only ever get more. (When the
   * switch comes back it takes the room of two buttons, so the count of
   * buttons alone may drop at that one width.)
   */
  test("gives back the switch, then buttons, as the line gets wider", () => {
    for (const variables of [false, true]) {
      let previous: MarkdownToolbarLayout | null = null;

      for (let width: number = 120; width <= 1200; width += 3) {
        const layout: MarkdownToolbarLayout = fit(width, { variables });

        if (previous) {
          if (previous.isModeToggleInBar) {
            expect(layout.isModeToggleInBar).toBe(true);
          }

          if (previous.isModeToggleInBar === layout.isModeToggleInBar) {
            expect(layout.visibleButtonCount).toBeGreaterThanOrEqual(
              previous.visibleButtonCount,
            );
          } else {
            // The switch is back with at least the first group beside it.
            expect(layout.visibleButtonCount).toBeGreaterThanOrEqual(
              TOOLBAR_MIN_BUTTONS,
            );
          }

          if (!previous.hasMoreMenu) {
            expect(layout.hasMoreMenu).toBe(false);
          }
        }

        previous = layout;
      }

      expect(previous).toEqual({
        visibleButtonCount: 19,
        isModeToggleInBar: true,
        hasMoreMenu: false,
      });
    }
  });

  test("at a stepped form's width in the old Medium dialog, keeps the first groups and the switch", () => {
    // 550px of editor, less the toolbar's padding and border.
    const layout: MarkdownToolbarLayout = fit(532);

    expect(layout.isModeToggleInBar).toBe(true);
    expect(layout.hasMoreMenu).toBe(true);
    // Bold to Task List: the text group, the headings, three list buttons.
    expect(layout.visibleButtonCount).toBe(10);
  });

  test("at a stepped form's width in the Large dialog, shows everything, Insert variable included", () => {
    // About 1060px of editor beside the step list on a 1280px screen.
    expect(fit(1040, { variables: true })).toEqual({
      visibleButtonCount: 19,
      isModeToggleInBar: true,
      hasMoreMenu: false,
    });
  });

  test("on a phone, Insert variable keeps its place and the switch moves into the menu", () => {
    // A 390px phone: the bottom sheet's body less its padding and the toolbar's.
    const layout: MarkdownToolbarLayout = fit(328, { variables: true });

    expect(layout.isModeToggleInBar).toBe(false);
    expect(layout.hasMoreMenu).toBe(true);
    expect(layout.visibleButtonCount).toBe(4);
  });

  test("on a phone without variables, the switch stays beside the first groups", () => {
    const layout: MarkdownToolbarLayout = fit(328);

    expect(layout.isModeToggleInBar).toBe(true);
    expect(layout.visibleButtonCount).toBeGreaterThanOrEqual(
      TOOLBAR_MIN_BUTTONS,
    );
  });

  test("moves the switch only when the first group would not fit beside it", () => {
    // Exactly the four buttons, the menu button and the switch.
    const tight: number =
      line([B, B, B, B, B, D, MODE_TOGGLE]) + TOOLBAR_SLACK_PX;

    expect(fit(tight)).toEqual({
      visibleButtonCount: 4,
      isModeToggleInBar: true,
      hasMoreMenu: true,
    });

    const layout: MarkdownToolbarLayout = fit(tight - 1);
    expect(layout.isModeToggleInBar).toBe(false);
    expect(layout.hasMoreMenu).toBe(true);
    expect(layout.visibleButtonCount).toBeGreaterThanOrEqual(4);
  });

  test("keeps the menu button whenever the switch is in it, even with every button on the line", () => {
    const layout: MarkdownToolbarLayout = fitMarkdownToolbar({
      availableWidth: line([B, B, B, B]) + TOOLBAR_GAP_PX + B + 2,
      // One group of four: they fit, but not beside an enormous switch.
      groupSizes: [4],
      modeToggleWidth: 500,
      variableButtonWidth: 0,
    });

    expect(layout).toEqual({
      visibleButtonCount: 4,
      isModeToggleInBar: false,
      hasMoreMenu: true,
    });
  });

  test("gives as many buttons as fit where even the narrowest line is too short", () => {
    const layout: MarkdownToolbarLayout = fit(110, { variables: true });

    expect(layout.isModeToggleInBar).toBe(false);
    expect(layout.hasMoreMenu).toBe(true);
    expect(layout.visibleButtonCount).toBe(0);
  });

  test("puts nothing away where there is nothing to measure", () => {
    expect(fit(0)).toEqual(getFullToolbarLayout(GROUPS));
    expect(fit(-10)).toEqual(getFullToolbarLayout(GROUPS));
    expect(fit(Number.NaN)).toEqual(getFullToolbarLayout(GROUPS));
  });

  test("counts the buttons a form actually has: no Image button", () => {
    const withImage: MarkdownToolbarLayout = fit(2000);
    const withoutImage: MarkdownToolbarLayout = fit(2000, {
      groups: GROUPS_WITHOUT_IMAGE,
    });

    expect(withImage.visibleButtonCount).toBe(19);
    expect(withoutImage.visibleButtonCount).toBe(18);
  });
});

describe("comparing layouts", () => {
  test("tells a changed layout from the same one", () => {
    const layout: MarkdownToolbarLayout = getFullToolbarLayout(GROUPS);

    expect(isSameToolbarLayout(layout, { ...layout })).toBe(true);
    expect(
      isSameToolbarLayout(layout, { ...layout, visibleButtonCount: 3 }),
    ).toBe(false);
    expect(
      isSameToolbarLayout(layout, { ...layout, isModeToggleInBar: false }),
    ).toBe(false);
    expect(isSameToolbarLayout(layout, { ...layout, hasMoreMenu: true })).toBe(
      false,
    );
  });
});
