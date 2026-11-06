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
 *   - a name cut short lacks what its text takes whole less what its box is
 *     given;
 *   - a name shown whole has to spare the room its button has left after
 *     it - the sidebar could be that much narrower and still show it.
 *
 * Every width is read to the part of a pixel the page lays it out at: the
 * text's from a range around it, which is as wide as the text however its
 * box cuts it short, rather than scrollWidth and clientWidth, which are
 * rounded to whole pixels. A sidebar fitted to its names is then fitted
 * already: a second double-click leaves it as it is, where whole pixels
 * moved it by one.
 *
 * React-free on purpose, like FacetSidebarWidth.
 */

/*
 * Less than this between a name's text and its box is the same width,
 * written two ways (its box is laid out in 64ths of a pixel).
 */
const SAME_WIDTH_IN_PX: number = 0.05;

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
 * How wide a name's text is, whole, on its one line: a range around it is
 * as wide as the text, wherever its box cuts it short. A page that cannot
 * say (a range with no box, as in a test's DOM) has scrollWidth, in whole
 * pixels.
 */
const getTextWidth: (name: HTMLElement) => number = (
  name: HTMLElement,
): number => {
  const ownerDocument: Document = name.ownerDocument;

  if (ownerDocument && typeof ownerDocument.createRange === "function") {
    const range: Range = ownerDocument.createRange();
    range.selectNodeContents(name);

    if (typeof range.getBoundingClientRect === "function") {
      const width: number = range.getBoundingClientRect().width;

      if (Number.isFinite(width) && width > 0) {
        return width;
      }
    }
  }

  return name.scrollWidth;
};

// How wide a name's box is drawn: to the part of a pixel, else whole.
const getBoxWidth: (name: HTMLElement) => number = (
  name: HTMLElement,
): number => {
  const width: number = name.getBoundingClientRect().width;

  return Number.isFinite(width) && width > 0 ? width : name.clientWidth;
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

    const lacking: number = getTextWidth(name) - getBoxWidth(name);

    if (lacking > SAME_WIDTH_IN_PX) {
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
