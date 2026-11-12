/*
 * Where the project picker's list opens on a small screen (#7236).
 *
 * The list is as wide as the picker, and on a phone the picker is what gives
 * way in the header (it is 100 to 180px wide there, between the logo's mark
 * and the bell): a list that narrow cut every project's name short and
 * broke Create New Project over two lines, so someone with several projects
 * could not tell them apart in the very list they open to choose one.
 *
 * Below sm (640px) the list is as wide as a phone allows - 20rem at most,
 * with a 1rem gutter from each edge of the window. It starts where the
 * picker starts (its left edge, or its right edge on a page that reads right
 * to left) and moves back only as far as it must to stay inside the window.
 * From sm the picker is wide enough, and the list is as wide as the picker,
 * as it always was.
 */

export const PROJECT_PICKER_WIDE_MENU_BELOW_WIDTH_IN_PX: number = 640;
export const PROJECT_PICKER_MENU_MAX_WIDTH_IN_PX: number = 320;
export const PROJECT_PICKER_MENU_GUTTER_IN_PX: number = 16;

export interface ProjectPickerMenuPlacementInput {
  // The picker's button, as getBoundingClientRect gives it.
  buttonLeft: number;
  buttonRight: number;
  // The window's width (innerWidth).
  windowWidth: number;
  isRightToLeft: boolean;
}

/*
 * The list's width, and how far its start is moved from the picker's start:
 * CSS left on a page that reads left to right, right on one that reads
 * right to left, negative when it moves out past the picker's own edge.
 */
export interface ProjectPickerMenuPlacement {
  widthInPx: number;
  side: "left" | "right";
  offsetInPx: number;
}

const clamp: (value: number, lowest: number, highest: number) => number = (
  value: number,
  lowest: number,
  highest: number,
): number => {
  return Math.max(lowest, Math.min(value, highest));
};

/*
 * Null when the list stays as wide as the picker: from sm, and on a screen
 * where the picker is already as wide as the list would be.
 */
export const getProjectPickerMenuPlacement: (
  input: ProjectPickerMenuPlacementInput,
) => ProjectPickerMenuPlacement | null = (
  input: ProjectPickerMenuPlacementInput,
): ProjectPickerMenuPlacement | null => {
  if (input.windowWidth >= PROJECT_PICKER_WIDE_MENU_BELOW_WIDTH_IN_PX) {
    return null;
  }

  const buttonWidth: number = input.buttonRight - input.buttonLeft;
  const widthInPx: number = Math.min(
    PROJECT_PICKER_MENU_MAX_WIDTH_IN_PX,
    input.windowWidth - 2 * PROJECT_PICKER_MENU_GUTTER_IN_PX,
  );

  if (widthInPx <= buttonWidth) {
    return null;
  }

  const lowestStart: number = PROJECT_PICKER_MENU_GUTTER_IN_PX;
  const highestEnd: number =
    input.windowWidth - PROJECT_PICKER_MENU_GUTTER_IN_PX;

  if (input.isRightToLeft) {
    // The list's right edge: the picker's, or as far left as it must go.
    const menuRight: number = clamp(
      input.buttonRight,
      lowestStart + widthInPx,
      highestEnd,
    );

    return {
      widthInPx: widthInPx,
      side: "right",
      offsetInPx: Math.round(input.buttonRight - menuRight),
    };
  }

  // The list's left edge: the picker's, or as far right as it must go.
  const menuLeft: number = clamp(
    input.buttonLeft,
    lowestStart,
    highestEnd - widthInPx,
  );

  return {
    widthInPx: widthInPx,
    side: "left",
    offsetInPx: Math.round(menuLeft - input.buttonLeft),
  };
};
