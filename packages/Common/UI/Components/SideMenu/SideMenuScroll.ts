/*
 * Bringing the lit entry of a side menu into sight inside the menu, and
 * showing that the menu scrolls.
 *
 * A side menu is never taller than the window: past that, it scrolls inside
 * itself (SideMenu caps its card to the space under the header). On a
 * window under about 1,000 pixels tall a long menu - a Kubernetes cluster's,
 * a status page's, Security Events' settings - opened with the entry for
 * the page below its fold, so the menu showed no sign of where the reader
 * was. It now scrolls that entry into sight when a page opens, and the
 * phone's menu does the same when it is opened.
 *
 * Only the menu's own list moves. Element.scrollIntoView would scroll every
 * scrolling box around the entry, the page included, and pull the page down
 * to the menu's entry on every navigation.
 *
 * An edge of the list with entries behind it fades out, as a telemetry
 * product's tab bar does (TabBarScroll), so a reader sees the list goes on
 * past it. Brought into sight flush against the list's edge, with nothing
 * past it in view and nothing to say there was more, the lit entry read as
 * the menu's last: a node's page showed Nodes at the foot of the menu, with
 * PVCs, PVs and the rest out of sight below it.
 */

export interface RevealBox {
  top: number;
  bottom: number;
}

/*
 * How much of a list's edge fades out (1.5rem) while there are entries
 * behind it: above, once the list is scrolled from its top; below, while
 * there are more past its fold. An edge with nothing behind it stays sharp.
 */
export const SIDE_MENU_FADE_IN_PX: number = 24;

/*
 * How much of the list is kept past the lit entry when the menu scrolls to
 * it (3rem): the fade, and the next entry or section heading - so the
 * reader sees where the entry sits and that the list goes on. The list
 * keeps the same room for an entry the keyboard reaches
 * (SIDE_MENU_SCROLL_PADDING_CLASS_NAME), so a focused entry never sits
 * under the fade.
 */
export const SIDE_MENU_REVEAL_PEEK_IN_PX: number = 48;

export const SIDE_MENU_SCROLL_PADDING_CLASS_NAME: string = "scroll-py-12";

function isFiniteNumber(value: number): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

/*
 * How far a scrolling list must scroll (positive: down) to show its lit
 * entry: 0 while the entry is clear of both edges' fades, so a click on an
 * entry in sight never moves the list under the pointer. Otherwise the
 * entry comes in with SIDE_MENU_REVEAL_PEEK_IN_PX to spare past it, and no
 * further, so as much of the menu as can stays where it was. A room too
 * small for that keeps half of what is left on either side of the entry,
 * and an entry taller than the room shows its top. The caller stops the
 * scroll at either end of the list, so the first entries stay at the top
 * and the last at the foot.
 */
export function getRevealScrollDelta(data: {
  list: RevealBox;
  entry: RevealBox;
}): number {
  const { list, entry } = data;

  if (![list.top, list.bottom, entry.top, entry.bottom].every(isFiniteNumber)) {
    return 0;
  }

  const roomHeight: number = list.bottom - list.top;
  const entryHeight: number = entry.bottom - entry.top;

  if (roomHeight <= 0 || entryHeight <= 0) {
    return 0;
  }

  // Clear of both fades: it stays where it is.
  if (
    entry.top >= list.top + SIDE_MENU_FADE_IN_PX &&
    entry.bottom <= list.bottom - SIDE_MENU_FADE_IN_PX
  ) {
    return 0;
  }

  // The room on each side of the entry, were it in the middle.
  const spare: number = (roomHeight - entryHeight) / 2;

  // Taller than the room: its top, not its bottom, is what to show.
  if (spare <= 0) {
    return entry.top - list.top;
  }

  const peek: number = Math.min(SIDE_MENU_REVEAL_PEEK_IN_PX, spare);

  // Under the bottom edge's fade, or past it: bring it in, the next peeking.
  if (entry.bottom > list.bottom - peek) {
    return entry.bottom - (list.bottom - peek);
  }

  // The same at the top edge.
  if (entry.top < list.top + peek) {
    return entry.top - (list.top + peek);
  }

  return 0;
}

// Which edges of a list have entries out of sight behind them.
export interface SideMenuHiddenEdges {
  top: boolean;
  bottom: boolean;
}

export const NO_HIDDEN_EDGES: SideMenuHiddenEdges = {
  top: false,
  bottom: false,
};

// How far past an edge the entries must reach before they count as hidden.
const HIDDEN_EPSILON_PX: number = 1;

/*
 * The edges with entries behind them, from what the list measures
 * (element.scrollTop, scrollHeight, clientHeight). A list that holds all
 * its entries has none. A scroll past either end - a touch screen's
 * overscroll bounce - reads as that end.
 */
export function getSideMenuHiddenEdges(measure: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): SideMenuHiddenEdges {
  if (
    ![measure.scrollTop, measure.scrollHeight, measure.clientHeight].every(
      isFiniteNumber,
    )
  ) {
    return NO_HIDDEN_EDGES;
  }

  const overflow: number = measure.scrollHeight - measure.clientHeight;

  if (overflow <= HIDDEN_EPSILON_PX) {
    return NO_HIDDEN_EDGES;
  }

  const fromTop: number = Math.min(overflow, Math.max(0, measure.scrollTop));

  return {
    top: fromTop > HIDDEN_EPSILON_PX,
    bottom: fromTop < overflow - HIDDEN_EPSILON_PX,
  };
}

/*
 * The fade for the hidden edges: a mask that takes the last 1.5rem of a
 * hidden edge to transparent. Colour-free, so it fades the entries into
 * whatever the card is, light or dark.
 */
export const SIDE_MENU_FADE_CLASS_NAMES: Readonly<{
  both: string;
  top: string;
  bottom: string;
}> = {
  both: "[-webkit-mask-image:linear-gradient(to_bottom,transparent,black_1.5rem,black_calc(100%-1.5rem),transparent)] [mask-image:linear-gradient(to_bottom,transparent,black_1.5rem,black_calc(100%-1.5rem),transparent)]",
  top: "[-webkit-mask-image:linear-gradient(to_bottom,transparent,black_1.5rem)] [mask-image:linear-gradient(to_bottom,transparent,black_1.5rem)]",
  bottom:
    "[-webkit-mask-image:linear-gradient(to_top,transparent,black_1.5rem)] [mask-image:linear-gradient(to_top,transparent,black_1.5rem)]",
};

export function getSideMenuFadeClassName(edges: SideMenuHiddenEdges): string {
  if (edges.top && edges.bottom) {
    return SIDE_MENU_FADE_CLASS_NAMES.both;
  }

  if (edges.top) {
    return SIDE_MENU_FADE_CLASS_NAMES.top;
  }

  if (edges.bottom) {
    return SIDE_MENU_FADE_CLASS_NAMES.bottom;
  }

  return "";
}

// Room kept under the menu's card, above the window's bottom edge.
export const SIDE_MENU_BOTTOM_GAP_IN_PX: number = 24;

/*
 * The least the menu's card is shrunk to. A card that would fit in less -
 * a window hardly taller than the page's header - runs on below the window
 * instead, and the page scrolls to it.
 */
export const SIDE_MENU_MIN_HEIGHT_IN_PX: number = 240;

/*
 * How tall the menu's card may be to end above the window's bottom edge:
 * the window under the card's top, less the gap.
 *
 * The card is capped in CSS to the window under the app's header, which is
 * its height once it sticks below the header as the page scrolls. On a page
 * not yet scrolled it starts lower, under the page's trail and title, and
 * the end of its list ran on below the window: a page low in the menu -
 * Delete, Audit Logs, a Settings page - opened with its entry out of sight,
 * out of reach of the menu's own scroll until the page was scrolled.
 */
export function getFittedMenuHeight(data: {
  cardTop: number;
  windowHeight: number;
}): number {
  return Math.max(
    data.windowHeight - Math.max(data.cardTop, 0) - SIDE_MENU_BOTTOM_GAP_IN_PX,
    SIDE_MENU_MIN_HEIGHT_IN_PX,
  );
}

// Caps the menu's card to end above the window's bottom edge, where it is now.
export function fitSideMenuCard(card: HTMLElement | null): void {
  if (!card) {
    return;
  }

  const height: number = getFittedMenuHeight({
    cardTop: card.getBoundingClientRect().top,
    windowHeight: window.innerHeight,
  });
  const maxHeight: string = `${height}px`;

  if (card.style.maxHeight !== maxHeight) {
    card.style.maxHeight = maxHeight;
  }
}

/*
 * The part of a list the reader can see: its box, cut to the window - in
 * case the menu's card still runs on below it (the least height above).
 */
export function getVisibleRoom(data: {
  list: RevealBox;
  windowHeight: number;
}): RevealBox {
  return {
    top: Math.max(data.list.top, 0),
    bottom: Math.min(data.list.bottom, data.windowHeight),
  };
}

/*
 * Scrolls `list` - and nothing around it - so the menu's lit entry is in
 * sight, with the next entry peeking past it: inside the list, and inside
 * the window. Does nothing when the list has no lit entry, when it does not
 * scroll, or when none of it is in the window.
 */
export function revealCurrentSideMenuEntry(list: HTMLElement | null): void {
  if (!list) {
    return;
  }

  const entry: HTMLElement | null =
    list.querySelector<HTMLElement>("[aria-current]");

  if (!entry || list.scrollHeight <= list.clientHeight) {
    return;
  }

  const listBox: DOMRect = list.getBoundingClientRect();
  const room: RevealBox = getVisibleRoom({
    list: { top: listBox.top, bottom: listBox.bottom },
    windowHeight: window.innerHeight,
  });

  if (room.bottom <= room.top) {
    return;
  }

  const entryBox: DOMRect = entry.getBoundingClientRect();
  const delta: number = getRevealScrollDelta({
    list: room,
    entry: { top: entryBox.top, bottom: entryBox.bottom },
  });
  // Never past either end of the list.
  const scrollTop: number = Math.min(
    Math.max(list.scrollTop + delta, 0),
    list.scrollHeight - list.clientHeight,
  );

  if (scrollTop !== list.scrollTop) {
    list.scrollTop = scrollTop;
  }
}
