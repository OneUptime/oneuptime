/*
 * THE HEADER'S ICON MENUS, FROM THE KEYBOARD (#7237).
 *
 * Help and the profile menu are menus (role="menu"), and a menu promises a
 * screen reader's user what WAI-ARIA's menu button pattern gives: its rows
 * are menu items, the focus moves into the menu as it opens, the arrow keys
 * move between the rows, Home and End go to the first and the last, Escape
 * closes it and gives the focus back to its button, and Tab leaves it. Its
 * rows were plain links and buttons and the arrows did nothing: a screen
 * reader announced a menu and found no item in it.
 *
 * What the keys do, worked out here from the menu as it is drawn, so the
 * button that opens a menu (HeaderIconDropdownButton) and the tests read
 * the same rules.
 */

// Every role a row of a menu can have: an action, a choice, an on/off.
export const HEADER_MENU_ITEM_SELECTOR: string =
  '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';

// The rows of an open menu that take the focus, in the order they are drawn.
export const getHeaderMenuItems: (
  menu: HTMLElement | null,
) => Array<HTMLElement> = (menu: HTMLElement | null): Array<HTMLElement> => {
  if (!menu) {
    return [];
  }

  return Array.from(
    menu.querySelectorAll<HTMLElement>(HEADER_MENU_ITEM_SELECTOR),
  ).filter((item: HTMLElement): boolean => {
    return (
      item.getAttribute("aria-disabled") !== "true" &&
      !(item instanceof HTMLButtonElement && item.disabled)
    );
  });
};

/*
 * Where Up, Down, Home and End take the focus from the row at `from` (-1:
 * none yet) of `count` rows, round from the last to the first: undefined
 * for any other key. Up and Down are the same on a page read from the
 * right, the menu's rows being one above another.
 */
export const getHeaderMenuItemIndexAfterKey: (data: {
  key: string;
  from: number;
  count: number;
}) => number | undefined = (data: {
  key: string;
  from: number;
  count: number;
}): number | undefined => {
  if (data.count === 0) {
    return undefined;
  }

  switch (data.key) {
    case "ArrowDown":
      return data.from < 0 ? 0 : (data.from + 1) % data.count;
    case "ArrowUp":
      return data.from < 0
        ? data.count - 1
        : (data.from - 1 + data.count) % data.count;
    case "Home":
      return 0;
    case "End":
      return data.count - 1;
    default:
      return undefined;
  }
};

/*
 * A row of choices side by side - the theme's Light, Dark and System - is
 * walked with Left and Right too, the way it is drawn: on a page read from
 * the right, Light is at the right and Left goes on to Dark. The step, or
 * 0 for a key that is neither.
 */
export const getHeaderMenuChoiceStep: (data: {
  key: string;
  isRightToLeft: boolean;
}) => number = (data: { key: string; isRightToLeft: boolean }): number => {
  const forward: string = data.isRightToLeft ? "ArrowLeft" : "ArrowRight";
  const backward: string = data.isRightToLeft ? "ArrowRight" : "ArrowLeft";

  if (data.key === forward) {
    return 1;
  }

  if (data.key === backward) {
    return -1;
  }

  return 0;
};

// Whether `element` is laid out right to left: its own dir, else the page's.
export const isHeaderMenuRightToLeft: (element: Element) => boolean = (
  element: Element,
): boolean => {
  return (
    (element.closest("[dir]")?.getAttribute("dir") ||
      document.documentElement.dir) === "rtl"
  );
};
