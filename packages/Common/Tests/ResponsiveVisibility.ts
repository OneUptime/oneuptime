/*
 * Answers "would a browser paint this element at viewport width W?" for markup
 * styled with Tailwind display utilities.
 *
 * jsdom has no stylesheet, so `toBeVisible()` cannot see a `max-lg:hidden`
 * wrapper: to jsdom the element is present and visible at every width, which is
 * exactly the blind spot that let the header ship with its whole right rail —
 * profile button included — wrapped in a lg-only container and therefore
 * missing on every phone and tablet. These helpers read the class attribute
 * instead and resolve the display the same way the cascade would.
 *
 * Scope: `display` only, from unprefixed, min-width (`md:`) and max-width
 * (`max-md:`) utilities. State and arbitrary variants (hover:, group-hover:,
 * dark:, group-[...]:, [...]: ...) are ignored on purpose — they cannot answer
 * a layout question.
 *
 * The precedence mirrors the stylesheet the vendored Tailwind 3.4.5 Play CDN
 * actually emits (checked against its output): unprefixed utilities first,
 * then `max-*` from the widest screen down (max-2xl ... max-sm), then the
 * min-width screens from the narrowest up (sm ... 2xl). Every one of those
 * selectors has the same specificity, so the later rule wins — and inside one
 * group the display utilities keep their own emit order, which puts `hidden`
 * last (so `flex hidden` is hidden, whatever order the classes are written in).
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
// The customer's screenshot that exposed the foreign `.hidden` rule.
export const WIDE_DESKTOP_WIDTH_IN_PX: number = 1917;

/*
 * A rule the app does not ship but a browser can carry anyway: Bootstrap 3 and
 * HTML5 Boilerplate both define exactly this, and browser extensions and user
 * stylesheets inject them into every page they touch. `!important` (or merely
 * being appended after Tailwind's <style>) makes it beat every responsive
 * display utility on an element that carries the bare `hidden` class — which
 * is how a customer lost the whole dashboard navigation bar.
 */
export const FOREIGN_HIDDEN_RULE_CSS: string =
  ".hidden{display:none !important}";

export interface VisibilityOptions {
  /*
   * Resolve as if the page also carried FOREIGN_HIDDEN_RULE_CSS. Markup that is
   * only on screen because a responsive utility overrides a bare `hidden`
   * reads as hidden at every width under this option.
   */
  withForeignHiddenRule?: boolean | undefined;
}

// Tailwind's emit order for display utilities; later wins inside one group.
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

/*
 * Precedence of each group in the emitted stylesheet. Unprefixed is 0, then
 * max-2xl (1) ... max-sm (5), then sm (6) ... 2xl (10).
 */
const UNPREFIXED_PRECEDENCE: number = 0;

function maxVariantPrecedence(breakpointIndex: number): number {
  return BREAKPOINT_ORDER.length - breakpointIndex;
}

function minVariantPrecedence(breakpointIndex: number): number {
  return BREAKPOINT_ORDER.length + 1 + breakpointIndex;
}

/*
 * Split a class token into its variants and utility on the `:` separators
 * that are not inside an arbitrary value, so `group-[:not(:hover)]:hidden`
 * reads as one (arbitrary) variant plus `hidden`, not four pieces.
 */
export function splitVariants(token: string): Array<string> {
  const parts: Array<string> = [];
  let depth: number = 0;
  let current: string = "";

  for (const character of token) {
    if (character === "[" || character === "(") {
      depth++;
    } else if (character === "]" || character === ")") {
      depth = Math.max(0, depth - 1);
    }

    if (character === ":" && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  parts.push(current);
  return parts;
}

/**
 * The `display` Tailwind resolves for one class attribute at a given viewport
 * width, or null when the markup sets no display at all (the element then keeps
 * whatever the user agent gives it, which is never `none`).
 */
export function resolveDisplay(
  classAttribute: string | null | undefined,
  viewportWidthInPx: number,
  options?: VisibilityOptions,
): string | null {
  const tokens: Array<string> = (classAttribute || "")
    .split(/\s+/)
    .filter(Boolean);

  if (options?.withForeignHiddenRule && tokens.includes("hidden")) {
    // The foreign rule matches the bare class and outranks everything we emit.
    return "hidden";
  }

  let winner: string | null = null;
  // -1 so an unprefixed utility (precedence 0) always beats "nothing yet".
  let winningPrecedence: number = -1;
  let winningOrder: number = -1;

  for (const token of tokens) {
    const parts: Array<string> = splitVariants(token);
    const utility: string = parts[parts.length - 1]!;
    const order: number = DISPLAY_UTILITIES.indexOf(utility);

    if (order === -1) {
      continue;
    }

    let precedence: number;

    if (parts.length === 1) {
      precedence = UNPREFIXED_PRECEDENCE;
    } else if (parts.length === 2) {
      const variant: string = parts[0]!;
      const isMaxVariant: boolean = variant.startsWith("max-");
      const breakpoint: string = isMaxVariant ? variant.slice(4) : variant;
      const breakpointIndex: number = BREAKPOINT_ORDER.indexOf(breakpoint);

      if (breakpointIndex === -1) {
        // A state, arbitrary or other non-breakpoint variant.
        continue;
      }

      const breakpointInPx: number = TAILWIND_BREAKPOINTS_IN_PX[breakpoint]!;

      if (isMaxVariant) {
        // `max-md:` is `@media not all and (min-width: 768px)`.
        if (viewportWidthInPx >= breakpointInPx) {
          continue;
        }
        precedence = maxVariantPrecedence(breakpointIndex);
      } else {
        if (viewportWidthInPx < breakpointInPx) {
          continue;
        }
        precedence = minVariantPrecedence(breakpointIndex);
      }
    } else {
      // e.g. lg:hover:flex — a state variant, which says nothing about layout.
      continue;
    }

    if (
      precedence > winningPrecedence ||
      (precedence === winningPrecedence && order > winningOrder)
    ) {
      winner = utility;
      winningPrecedence = precedence;
      winningOrder = order;
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
  options?: VisibilityOptions,
): Element | null {
  let node: Element | null = element;

  while (node) {
    if (
      resolveDisplay(node.getAttribute("class"), viewportWidthInPx, options) ===
      "hidden"
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
  options?: VisibilityOptions,
): boolean {
  return (
    Boolean(element) &&
    findHidingElement(element, viewportWidthInPx, options) === null
  );
}

/**
 * A failure message that names the element doing the hiding and the classes
 * that do it, so a broken expectation points straight at the markup to fix.
 */
export function describeVisibility(
  element: Element | null,
  viewportWidthInPx: number,
  options?: VisibilityOptions,
): string {
  if (!element) {
    return "the element was never rendered";
  }

  const hiding: Element | null = findHidingElement(
    element,
    viewportWidthInPx,
    options,
  );

  const suffix: string = options?.withForeignHiddenRule
    ? " with a foreign .hidden rule on the page"
    : "";

  if (!hiding) {
    return `visible at ${viewportWidthInPx}px${suffix}`;
  }

  return `hidden at ${viewportWidthInPx}px${suffix} by <${hiding.tagName.toLowerCase()} class="${hiding.getAttribute(
    "class",
  )}">`;
}
