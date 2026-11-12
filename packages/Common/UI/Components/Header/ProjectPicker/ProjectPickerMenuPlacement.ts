/*
 * Where the project picker's list opens (#7236).
 *
 * The list was exactly as wide as the picker, and the picker is the header's
 * entry that gives way when the header is tight: 100 to 180px on a phone
 * (between the logo's mark and the bell), about 200px on a tablet (beside
 * Search and Help), and its full 16rem only on a wide screen. A list that
 * narrow cut every project's name short and broke Create New Project over
 * two lines ("Neues Projekt / erstellen" on a 768px tablet), so someone with
 * several projects could not tell them apart in the very list they open to
 * choose one; even at 1280px a 24-letter name lost its last word.
 *
 * So the list is 20rem wide at every width, or the window less a 1rem gutter
 * on each side when that is narrower (a phone), and never narrower than the
 * picker. It starts where the picker starts (its left edge, or its right
 * edge on a page that reads right to left) and moves back only as far as it
 * must to stay inside the window.
 */

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
 * Null when the list stays as wide as the picker: a picker already as wide
 * as the list would be.
 */
export const getProjectPickerMenuPlacement: (
  input: ProjectPickerMenuPlacementInput,
) => ProjectPickerMenuPlacement | null = (
  input: ProjectPickerMenuPlacementInput,
): ProjectPickerMenuPlacement | null => {
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
