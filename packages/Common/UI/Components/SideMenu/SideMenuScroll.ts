/*
 * Bringing the lit entry of a side menu into sight inside the menu.
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
 */

// Room kept between the entry and the edge of the list it is brought into.
export const SIDE_MENU_REVEAL_MARGIN_IN_PX: number = 8;

export interface RevealBox {
  top: number;
  bottom: number;
}

/*
 * How far a scrolling list must scroll (positive: down) for an entry inside
 * it to be in sight with `margin` pixels to spare, moving the least it can:
 * 0 when the entry is in sight already. An entry taller than the list is
 * brought to its top.
 */
export function getRevealScrollDelta(data: {
  list: RevealBox;
  entry: RevealBox;
  margin: number;
}): number {
  const visibleTop: number = data.list.top + data.margin;
  const visibleBottom: number = data.list.bottom - data.margin;

  if (data.entry.top < visibleTop) {
    return data.entry.top - visibleTop;
  }

  if (data.entry.bottom > visibleBottom) {
    const delta: number = data.entry.bottom - visibleBottom;
    const entryHeight: number = data.entry.bottom - data.entry.top;
    const roomHeight: number = visibleBottom - visibleTop;

    // Taller than the room: its top, not its bottom, is what to show.
    return entryHeight > roomHeight ? data.entry.top - visibleTop : delta;
  }

  return 0;
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
 * sight: inside the list, and inside the window. Does nothing when the list
 * has no lit entry, when it does not scroll, or when none of it is in the
 * window.
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
    margin: SIDE_MENU_REVEAL_MARGIN_IN_PX,
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
