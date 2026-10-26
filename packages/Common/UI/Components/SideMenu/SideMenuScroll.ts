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

/*
 * Scrolls `list` - and nothing around it - so the menu's lit entry is in
 * sight. Does nothing when the list has no lit entry, or when it does not
 * scroll.
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
  const entryBox: DOMRect = entry.getBoundingClientRect();
  const delta: number = getRevealScrollDelta({
    list: { top: listBox.top, bottom: listBox.bottom },
    entry: { top: entryBox.top, bottom: entryBox.bottom },
    margin: SIDE_MENU_REVEAL_MARGIN_IN_PX,
  });

  if (delta !== 0) {
    list.scrollTop = list.scrollTop + delta;
  }
}
