/*
 * Answers "would a browser paint this element at viewport width W?" for markup
 * styled with Tailwind display utilities.
 *
 * jsdom has no stylesheet, so `toBeVisible()` cannot see a `hidden lg:flex`
 * wrapper: to jsdom the element is present and visible at every width, which is
 * exactly the blind spot that let the header ship with its whole right rail —
 * profile button included — wrapped in `hidden lg:flex` and therefore missing
 * on every phone and tablet. These helpers read the class attribute instead and
 * resolve the display the same way the cascade would.
 *
 * Scope: `display` only, and only unprefixed or min-width-breakpoint-prefixed
 * utilities. State variants (hover:, focus:, dark: ...) are ignored on purpose —
 * they cannot answer the question this asks. A `max-*` breakpoint variant on a
 * display utility throws rather than being silently ignored, so this never
 * quietly reports "visible" about markup it does not model.
 */

export const TAILWIND_BREAKPOINTS_IN_PX: Record<string, number> = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1536,
};

// Widths worth asserting at. Named so failures read as devices, not numbers.
export const PHONE_WIDTH_IN_PX: number = 375;
export const TABLET_WIDTH_IN_PX: number = 768;
export const LAPTOP_WIDTH_IN_PX: number = 1280;

const DISPLAY_UTILITIES: Array<string> = [
  "block",
  "inline-block",
  "inline",
  "flex",
  "inline-flex",
  "table",
  "inline-table",
  "table-caption",
  "table-cell",
  "table-column",
  "table-column-group",
  "table-footer-group",
  "table-header-group",
  "table-row-group",
  "table-row",
  "flow-root",
  "grid",
  "inline-grid",
  "contents",
  "list-item",
  "hidden",
];

const BREAKPOINT_ORDER: Array<string> = ["sm", "md", "lg", "xl", "2xl"];

/**
 * The `display` Tailwind resolves for one class attribute at a given viewport
 * width, or null when the markup sets no display at all (the element then keeps
 * whatever the user agent gives it, which is never `none`).
 */
export function resolveDisplay(
  classAttribute: string | null | undefined,
  viewportWidthInPx: number,
): string | null {
  let winner: string | null = null;
  // -1 so an unprefixed utility (precedence 0) always beats "nothing yet".
  let winningPrecedence: number = -1;

  for (const token of (classAttribute || "").split(/\s+/)) {
    if (!token) {
      continue;
    }

    const parts: Array<string> = token.split(":");
    const utility: string = parts[parts.length - 1]!;

    if (!DISPLAY_UTILITIES.includes(utility)) {
      continue;
    }

    // Unprefixed: applies at every width.
    if (parts.length === 1) {
      if (winningPrecedence <= 0) {
        winner = utility;
        winningPrecedence = 0;
      }
      continue;
    }

    if (parts.length !== 2) {
      // e.g. lg:hover:flex — a state variant, which says nothing about layout.
      continue;
    }

    const variant: string = parts[0]!;

    if (variant.startsWith("max-")) {
      throw new Error(
        `resolveDisplay does not model max-width variants, and "${token}" is one. ` +
          `Teach it the reverse-ordered cascade before using it on this markup.`,
      );
    }

    const breakpointIndex: number = BREAKPOINT_ORDER.indexOf(variant);

    if (breakpointIndex === -1) {
      // A state or other non-breakpoint variant.
      continue;
    }

    if (TAILWIND_BREAKPOINTS_IN_PX[variant]! > viewportWidthInPx) {
      // The media query does not match at this width.
      continue;
    }

    const precedence: number = breakpointIndex + 1;

    if (precedence >= winningPrecedence) {
      winner = utility;
      winningPrecedence = precedence;
    }
  }

  return winner;
}

/**
 * The element — itself or the nearest ancestor — that takes this subtree off
 * the screen at the given width, or null when nothing does.
 */
export function findHidingElement(
  element: Element | null,
  viewportWidthInPx: number,
): Element | null {
  let node: Element | null = element;

  while (node) {
    if (
      resolveDisplay(node.getAttribute("class"), viewportWidthInPx) === "hidden"
    ) {
      return node;
    }

    node = node.parentElement;
  }

  return null;
}

/** Whether the element is painted at the given viewport width. */
export function isVisibleAtWidth(
  element: Element | null,
  viewportWidthInPx: number,
): boolean {
  return (
    Boolean(element) && findHidingElement(element, viewportWidthInPx) === null
  );
}

/**
 * A failure message that names the element doing the hiding and the classes
 * that do it, so a broken expectation points straight at the markup to fix.
 */
export function describeVisibility(
  element: Element | null,
  viewportWidthInPx: number,
): string {
  if (!element) {
    return "the element was never rendered";
  }

  const hiding: Element | null = findHidingElement(element, viewportWidthInPx);

  if (!hiding) {
    return `visible at ${viewportWidthInPx}px`;
  }

  return `hidden at ${viewportWidthInPx}px by <${hiding.tagName.toLowerCase()} class="${hiding.getAttribute(
    "class",
  )}">`;
}
