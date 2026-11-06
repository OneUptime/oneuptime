/*
 * What the filters sidebar's names take, read off the page - once, as a
 * person asks the sidebar to fit them (a double-click on its edge, or End),
 * never while they drag. FacetSidebarWidth's getFacetSidebarFitWidth turns
 * what is read here into a width.
 *
 * A name is a value a facet lists (TelemetryFacetValueRow marks it with
 * FACET_SIDEBAR_NAME_ATTRIBUTE): a service, a host, a pod. Each is drawn on
 * one line, cut short with "…" when its row has no room, at the start of
 * the row's button, which takes every pixel the row has left over. So,
 * without drawing the sidebar again:
 *
 *   - a name cut short lacks what it would take whole (scrollWidth) less
 *     what it is given (clientWidth);
 *   - a name shown whole has to spare the room its button has left after
 *     it - the sidebar could be that much narrower and still show it.
 *
 * React-free on purpose, like FacetSidebarWidth.
 */

/*
 * On a name the fit reads: the value a facet row lists. Only these - a
 * section's title, the search box and the counts are as wide as they are
 * at any width.
 */
export const FACET_SIDEBAR_NAME_ATTRIBUTE: string = "data-facet-sidebar-name";

const getComputedStyleOf: (element: Element) => CSSStyleDeclaration | null = (
  element: Element,
): CSSStyleDeclaration | null => {
  if (typeof window === "undefined" || !window.getComputedStyle) {
    return null;
  }

  return window.getComputedStyle(element);
};

const readPixels: (value: string | undefined) => number = (
  value: string | undefined,
): number => {
  const pixels: number = parseFloat(value || "");

  return Number.isFinite(pixels) ? pixels : 0;
};

// Whether the page reads right to left where this element is.
export const isFacetSidebarRightToLeft: (element: Element) => boolean = (
  element: Element,
): boolean => {
  return getComputedStyleOf(element)?.direction === "rtl";
};

/*
 * Whether an element takes its place in its row: not left out (display:
 * none) and not drawn over the row (absolute, fixed) - a screen reader's
 * "Excluded" after a name, an exclude button over the count.
 */
const isInFlow: (element: Element) => boolean = (
  element: Element,
): boolean => {
  const style: CSSStyleDeclaration | null = getComputedStyleOf(element);

  if (!style) {
    return true;
  }

  return (
    style.display !== "none" &&
    style.position !== "absolute" &&
    style.position !== "fixed"
  );
};

/*
 * The room a name's box has left after what it holds: from the end of its
 * last child that takes a place in it to the end of its content - the
 * right, less its padding and border, on a page that reads left to right;
 * the left on one that reads right to left.
 */
const getRoomLeftInBox: (box: Element, isRightToLeft: boolean) => number = (
  box: Element,
  isRightToLeft: boolean,
): number => {
  const children: Array<Element> = Array.from(box.children).filter(
    (child: Element): boolean => {
      return isInFlow(child);
    },
  );

  if (children.length === 0) {
    return 0;
  }

  const boxRect: DOMRect = box.getBoundingClientRect();
  const style: CSSStyleDeclaration | null = getComputedStyleOf(box);

  if (isRightToLeft) {
    const contentStart: number =
      boxRect.left +
      readPixels(style?.borderLeftWidth) +
      readPixels(style?.paddingLeft);
    const childrenStart: number = Math.min(
      ...children.map((child: Element): number => {
        return child.getBoundingClientRect().left;
      }),
    );

    return Math.max(0, childrenStart - contentStart);
  }

  const contentEnd: number =
    boxRect.right -
    readPixels(style?.borderRightWidth) -
    readPixels(style?.paddingRight);
  const childrenEnd: number = Math.max(
    ...children.map((child: Element): number => {
      return child.getBoundingClientRect().right;
    }),
  );

  return Math.max(0, contentEnd - childrenEnd);
};

/*
 * What each name the sidebar lists lacks (positive) or has to spare
 * (negative), in pixels, at the width it is drawn at now. A name not drawn
 * (a folded section's, a phone's hidden sidebar) is left out: it has no box.
 */
export const getFacetNameShortfalls: (panel: Element) => Array<number> = (
  panel: Element,
): Array<number> => {
  const isRightToLeft: boolean = isFacetSidebarRightToLeft(panel);
  const shortfalls: Array<number> = [];

  for (const name of Array.from(
    panel.querySelectorAll(`[${FACET_SIDEBAR_NAME_ATTRIBUTE}]`),
  )) {
    if (!(name instanceof HTMLElement) || name.getClientRects().length === 0) {
      continue;
    }

    const lacking: number = name.scrollWidth - name.clientWidth;

    if (lacking > 0) {
      shortfalls.push(lacking);
      continue;
    }

    const box: Element | null = name.parentElement;
    const spare: number = box ? getRoomLeftInBox(box, isRightToLeft) : 0;

    shortfalls.push(spare > 0 ? -spare : 0);
  }

  return shortfalls;
};

/*
 * How wide the facets + list area is - the room the sidebar shares with the
 * list: its parent's content box. Zero when it is not drawn.
 */
export const getFacetSidebarRoomWidth: (panel: Element) => number = (
  panel: Element,
): number => {
  const room: Element | null = panel.parentElement;

  if (!room) {
    return 0;
  }

  const style: CSSStyleDeclaration | null = getComputedStyleOf(room);

  return Math.max(
    0,
    room.clientWidth -
      readPixels(style?.paddingLeft) -
      readPixels(style?.paddingRight),
  );
};

// How wide the sidebar is drawn now, in pixels.
export const getFacetSidebarDrawnWidth: (panel: Element) => number = (
  panel: Element,
): number => {
  return panel.getBoundingClientRect().width;
};
