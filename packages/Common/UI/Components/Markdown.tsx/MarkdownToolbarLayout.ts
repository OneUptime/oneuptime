/*
 * Which of the Markdown editor's formatting buttons fit on its toolbar's one
 * line, and what goes under the More formatting button (...) when they do
 * not all fit.
 *
 * The toolbar used to wrap. In a dialog the width of a note template form
 * its buttons took two lines, and on a phone five. It now keeps one line at
 * any width: the formatting buttons stay in their order, those that do not
 * fit leave from the end into the menu, and the menu button takes their
 * place. Two things stay on the line, because they are not formatting: the
 * Markdown / Visual switch and, when the field has template variables,
 * Insert variable. When even the first group of buttons (Bold, Italic,
 * Underline, Strikethrough) would not fit beside them, the switch moves into
 * the menu too: Insert variable is what a template form is for, so it keeps
 * its place and its words.
 *
 * Every formatting button is the same square (TOOLBAR_BUTTON_PX), so where
 * the line ends is arithmetic: MarkdownEditor measures only the line itself
 * and the two controls whose words set their width.
 *
 * Pure: widths in, a layout out.
 */

// A formatting button: w-8, a 32px square.
export const TOOLBAR_BUTTON_PX: number = 32;

// The toolbar's gap-1 between its buttons, dividers and controls.
export const TOOLBAR_GAP_PX: number = 4;

// The w-px line between two groups of buttons.
export const TOOLBAR_DIVIDER_PX: number = 1;

/*
 * Room kept spare, so a line that would fit by a hair - fractional widths,
 * a zoomed page, a font that arrives late - does not spill instead.
 */
export const TOOLBAR_SLACK_PX: number = 2;

/*
 * The first group's four buttons: fewer than this beside the switch, and the
 * switch gives up its place on the line before the buttons do.
 */
export const TOOLBAR_MIN_BUTTONS: number = 4;

export interface MarkdownToolbarMeasurements {
  // The width of the toolbar's line, inside its padding.
  availableWidth: number;
  // How many formatting buttons each group has, in toolbar order.
  groupSizes: ReadonlyArray<number>;
  // The Markdown / Visual switch, as it reads now.
  modeToggleWidth: number;
  // Insert variable; 0 when the field has no template variables.
  variableButtonWidth: number;
}

export interface MarkdownToolbarLayout {
  // The first this many formatting buttons are on the line, the rest in the menu.
  visibleButtonCount: number;
  // The Markdown / Visual switch is on the line, not in the menu.
  isModeToggleInBar: boolean;
  // The More formatting button is there: something is in its menu.
  hasMoreMenu: boolean;
}

export type CountToolbarButtonsFunction = (
  groupSizes: ReadonlyArray<number>,
) => number;

export const countToolbarButtons: CountToolbarButtonsFunction = (
  groupSizes: ReadonlyArray<number>,
): number => {
  return groupSizes.reduce((total: number, size: number): number => {
    return total + Math.max(0, size);
  }, 0);
};

export type GetFullToolbarLayoutFunction = (
  groupSizes: ReadonlyArray<number>,
) => MarkdownToolbarLayout;

/*
 * Everything on the line, nothing in a menu: the toolbar before it has been
 * measured, and wherever there is nothing to measure (jsdom, a field inside
 * something that is not shown).
 */
export const getFullToolbarLayout: GetFullToolbarLayoutFunction = (
  groupSizes: ReadonlyArray<number>,
): MarkdownToolbarLayout => {
  return {
    visibleButtonCount: countToolbarButtons(groupSizes),
    isModeToggleInBar: true,
    hasMoreMenu: false,
  };
};

export type CountVisibleGroupsFunction = (
  groupSizes: ReadonlyArray<number>,
  visibleButtonCount: number,
) => number;

// How many groups the first `visibleButtonCount` buttons reach into.
export const countVisibleGroups: CountVisibleGroupsFunction = (
  groupSizes: ReadonlyArray<number>,
  visibleButtonCount: number,
): number => {
  let groups: number = 0;
  let start: number = 0;

  for (const size of groupSizes) {
    if (size <= 0) {
      continue;
    }

    if (start >= visibleButtonCount) {
      break;
    }

    groups++;
    start += size;
  }

  return groups;
};

export interface ToolbarLineContents {
  groupSizes: ReadonlyArray<number>;
  visibleButtonCount: number;
  hasMoreMenu: boolean;
  // The switch's width when it is on the line; 0 when it is in the menu.
  modeToggleWidth: number;
  // Insert variable's width; 0 when there is none.
  variableButtonWidth: number;
}

export type GetToolbarLineWidthFunction = (
  contents: ToolbarLineContents,
) => number;

/*
 * How wide the line is with these things on it, as the toolbar lays it out:
 * the visible buttons with a divider between groups, the More formatting
 * button after them, a divider and the switch, then Insert variable - each
 * a gap apart.
 */
export const getToolbarLineWidth: GetToolbarLineWidthFunction = (
  contents: ToolbarLineContents,
): number => {
  let width: number = 0;
  let items: number = 0;

  const buttons: number = Math.max(0, contents.visibleButtonCount);

  if (buttons > 0) {
    const dividers: number = Math.max(
      0,
      countVisibleGroups(contents.groupSizes, buttons) - 1,
    );

    width += buttons * TOOLBAR_BUTTON_PX + dividers * TOOLBAR_DIVIDER_PX;
    items += buttons + dividers;
  }

  if (contents.hasMoreMenu) {
    width += TOOLBAR_BUTTON_PX;
    items += 1;
  }

  if (contents.modeToggleWidth > 0) {
    // The divider before the switch, then the switch.
    width += TOOLBAR_DIVIDER_PX + contents.modeToggleWidth;
    items += 2;
  }

  if (contents.variableButtonWidth > 0) {
    width += contents.variableButtonWidth;
    items += 1;
  }

  return width + Math.max(0, items - 1) * TOOLBAR_GAP_PX;
};

export type FitMarkdownToolbarFunction = (
  measurements: MarkdownToolbarMeasurements,
) => MarkdownToolbarLayout;

export const fitMarkdownToolbar: FitMarkdownToolbarFunction = (
  measurements: MarkdownToolbarMeasurements,
): MarkdownToolbarLayout => {
  const total: number = countToolbarButtons(measurements.groupSizes);

  /*
   * No width at all is no layout, not a toolbar with no room: jsdom, or an
   * editor inside something that is not shown. Nothing is put away.
   */
  if (
    !Number.isFinite(measurements.availableWidth) ||
    measurements.availableWidth <= 0
  ) {
    return getFullToolbarLayout(measurements.groupSizes);
  }

  const room: number = measurements.availableWidth - TOOLBAR_SLACK_PX;
  const enough: number = Math.min(TOOLBAR_MIN_BUTTONS, total);

  // The switch on the line first; then, if that leaves too little, in the menu.
  let layout: MarkdownToolbarLayout = getFullToolbarLayout(
    measurements.groupSizes,
  );

  for (const isModeToggleInBar of [true, false]) {
    let fits: number = 0;

    // The most buttons that fit, the menu button counted when it is needed.
    for (let count: number = total; count >= 0; count--) {
      const hasMoreMenu: boolean = count < total || !isModeToggleInBar;

      const width: number = getToolbarLineWidth({
        groupSizes: measurements.groupSizes,
        visibleButtonCount: count,
        hasMoreMenu: hasMoreMenu,
        modeToggleWidth: isModeToggleInBar ? measurements.modeToggleWidth : 0,
        variableButtonWidth: measurements.variableButtonWidth,
      });

      if (width <= room) {
        fits = count;
        break;
      }
    }

    layout = {
      visibleButtonCount: fits,
      isModeToggleInBar: isModeToggleInBar,
      hasMoreMenu: fits < total || !isModeToggleInBar,
    };

    if (fits >= enough) {
      return layout;
    }
  }

  // The switch in the menu, with as many buttons as fit beside it.
  return layout;
};

export type IsSameToolbarLayoutFunction = (
  a: MarkdownToolbarLayout,
  b: MarkdownToolbarLayout,
) => boolean;

export const isSameToolbarLayout: IsSameToolbarLayoutFunction = (
  a: MarkdownToolbarLayout,
  b: MarkdownToolbarLayout,
): boolean => {
  return (
    a.visibleButtonCount === b.visibleButtonCount &&
    a.isModeToggleInBar === b.isModeToggleInBar &&
    a.hasMoreMenu === b.hasMoreMenu
  );
};
