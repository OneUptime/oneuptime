/*
 * Brings the box an element scrolls in back to its top: the first one
 * around it whose content runs past it and that scrolls (overflow-y auto or
 * scroll) - a dialog's body, most often.
 *
 * For a view that turns over in place: a dialog's next step, or the next
 * page of a list read while its last rows were in view. Without it the new
 * content opened where the old was scrolled to - half way down a step, or
 * at the foot of a page - with its start out of sight.
 *
 * A box that does not scroll is passed over, however tall. Nothing happens
 * where nothing scrolls, or for no element at all.
 */
export function scrollToTopOfScroller(element: HTMLElement | null): void {
  let node: HTMLElement | null = element?.parentElement || null;

  while (node) {
    const overflowY: string = window.getComputedStyle(node).overflowY;

    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight
    ) {
      node.scrollTop = 0;
      return;
    }

    node = node.parentElement;
  }
}

export default scrollToTopOfScroller;
