/*
 * The look of a ⋯ that is not a card header's: a bare icon - no outline,
 * fill or shadow until it is hovered - as a list row's is. MoreMenu draws
 * its own trigger this way, with its words beside the icon when it has
 * some (a public dashboard's auto-refresh interval), and RowActions' row ⋯
 * is the same button. A card header's ⋯ is CardMoreMenu's, bordered like
 * the buttons beside it.
 *
 * It keeps a transparent border so it stays the height of the Small row
 * button beside it - that button's label is text-base below md and text-sm
 * above, so the vertical padding steps down at md to keep the two level.
 * Locked, it fades with the not-allowed cursor, as a locked Button does.
 */
export const MORE_MENU_BARE_TRIGGER_CLASS_NAME: string =
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-transparent bg-transparent py-1.5 md:py-1 text-gray-500 transition-colors duration-150 ease-out hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent";

// An icon alone is a square; words beside it get room and the reading size.
export const MORE_MENU_BARE_TRIGGER_ICON_ONLY_CLASS_NAME: string = "px-1.5";

export const MORE_MENU_BARE_TRIGGER_WITH_TEXT_CLASS_NAME: string =
  "px-2 text-sm font-medium";

export const getMoreMenuBareTriggerClassName: (hasText: boolean) => string = (
  hasText: boolean,
): string => {
  return `${MORE_MENU_BARE_TRIGGER_CLASS_NAME} ${
    hasText
      ? MORE_MENU_BARE_TRIGGER_WITH_TEXT_CLASS_NAME
      : MORE_MENU_BARE_TRIGGER_ICON_ONLY_CLASS_NAME
  }`;
};
