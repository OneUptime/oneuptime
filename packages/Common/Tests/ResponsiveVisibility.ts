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
 *
 * The bottom of the file answers the same question for `sr-only`, whose
 * foreign twin loses to state variants and beats media-query ones - see
 * isMediaQueryVariant and isVisuallyCollapsed.
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

/*
 * `block`, `flex`, `hidden` ... - any of Tailwind's display utilities, for
 * callers that read class attributes without resolving them.
 */
export function isDisplayUtility(utility: string): boolean {
  return DISPLAY_UTILITIES.includes(utility);
}

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

// A max-width hide, e.g. `max-lg:hidden` — the form the foreign-rule fix introduced.
export const MAX_WIDTH_HIDDEN_CLASS: RegExp = /^max-(sm|md|lg|xl|2xl):hidden$/;

/**
 * Put the pre-fix idiom back on everything rendered under `root`: every
 * `max-<breakpoint>:hidden` becomes the bare `hidden` it replaced. Nothing in
 * the UI used a max-width hide before that fix, so this rebuilds the old class
 * strings exactly — and lets a test show that its own assertion fails against
 * them, rather than passing whatever the markup says.
 */
export function restorePreFixMarkup(root: ParentNode = document): void {
  for (const element of Array.from(root.querySelectorAll("[class]"))) {
    const tokens: Array<string> = (element.getAttribute("class") || "").split(
      /\s+/,
    );

    element.setAttribute(
      "class",
      tokens
        .map((token: string): string => {
          return MAX_WIDTH_HIDDEN_CLASS.test(token) ? "hidden" : token;
        })
        .join(" "),
    );
  }
}

/*
 * ---------------------------------------------------------------------------
 * The `sr-only` sibling of the foreign rule.
 *
 * Bootstrap 3 and HTML5 Boilerplate - the two stylesheets that ship the
 * foreign `.hidden` - also ship `.sr-only`, the visually-hidden pattern, and
 * that one is NOT !important. So what decides it is specificity, then source
 * order. Appended after Tailwind's <style>, the foreign `.sr-only`, (0,1,0),
 * ties with any utility whose selector is one class - an unprefixed one, or
 * one behind a media-query variant, since an @media wrapper adds nothing -
 * and wins on order: `sr-only sm:not-sr-only` collapses to 1px at every width.
 * A variant that adds to the selector out-specifies it wherever it sits:
 * `.focus\:not-sr-only:focus` (a skip link), `.group:hover
 * .group-hover\:not-sr-only`, `[aria-expanded="true"]`, `[data-state=...]`,
 * and `.dark\:not-sr-only:is(.dark *)` under darkMode "class" all show the
 * element whatever the foreign sheet says.
 *
 * isMediaQueryVariant below is the suite's one definition of "adds no
 * specificity". This file is the source of truth for it: the resolver here
 * gives it meaning, and ForeignHiddenRuleGuard's sr-only check imports it
 * rather than keeping a list of its own, so the guard flags exactly the
 * `not-sr-only` variants this resolver lets a foreign `.sr-only` beat.
 * ---------------------------------------------------------------------------
 */

/*
 * The media-query variants that do not test the width, and where Tailwind
 * 3.4.5 emits each one (checked against the vendored Play CDN's variant
 * order under darkMode "class": motion, contrast, dark, the screens,
 * orientation, direction, forced-colors, print). The screens sit between 3
 * and 5 - see screenPrecedence.
 */
const NON_WIDTH_MEDIA_PRECEDENCE: ReadonlyMap<string, number> = new Map<
  string,
  number
>([
  ["motion-safe", 1],
  ["motion-reduce", 1],
  ["contrast-more", 2],
  ["contrast-less", 2],
  ["portrait", 5],
  ["landscape", 5],
  ["forced-colors", 6],
  ["print", 7],
]);

export const NON_WIDTH_MEDIA_VARIANTS: ReadonlyArray<string> = Array.from(
  NON_WIDTH_MEDIA_PRECEDENCE.keys(),
);

// `min-[900px]`, `max-[62rem]` ...: an arbitrary screen.
const ARBITRARY_SCREEN_VARIANT: RegExp = /^(min|max)-\[([^\]]+)\]$/;
const PIXEL_LENGTH: RegExp = /^(\d+(?:\.\d+)?)px$/;

// Keeps every real screen width between two whole precedence steps.
const SCREEN_WIDTH_SCALE_IN_PX: number = 100000;

interface ScreenCondition {
  direction: "min" | "max";
  /*
   * null for an arbitrary screen not written in px: with the px `screens`
   * this app configures, the CDN warns about mixed units and emits nothing
   * for it, so it never applies.
   */
  widthInPx: number | null;
}

// The width a screen variant tests, or null when it is not a screen variant.
function screenConditionOf(variant: string): ScreenCondition | null {
  if (BREAKPOINT_ORDER.includes(variant)) {
    return {
      direction: "min",
      widthInPx: TAILWIND_BREAKPOINTS_IN_PX[variant]!,
    };
  }

  const maxBreakpoint: string = variant.slice(4);

  if (variant.startsWith("max-") && BREAKPOINT_ORDER.includes(maxBreakpoint)) {
    return {
      direction: "max",
      widthInPx: TAILWIND_BREAKPOINTS_IN_PX[maxBreakpoint]!,
    };
  }

  const arbitrary: RegExpMatchArray | null = variant.match(
    ARBITRARY_SCREEN_VARIANT,
  );

  if (!arbitrary) {
    return null;
  }

  const pixels: RegExpMatchArray | null = arbitrary[2]!.match(PIXEL_LENGTH);

  return {
    direction: arbitrary[1] === "min" ? "min" : "max",
    widthInPx: pixels ? parseFloat(pixels[1]!) : null,
  };
}

/*
 * Tailwind emits every max-width screen, widest first, before every
 * min-width one, narrowest first - the named screens and arbitrary ones
 * interleaved by width (they share one sort in the CDN).
 */
function screenPrecedence(screen: ScreenCondition, widthInPx: number): number {
  return screen.direction === "max"
    ? 3 + (1 - widthInPx / SCREEN_WIDTH_SCALE_IN_PX)
    : 4 + widthInPx / SCREEN_WIDTH_SCALE_IN_PX;
}

/**
 * Whether a variant wraps its utility in an @media query and nothing else,
 * so it adds no specificity: the screens (sm ... 2xl, max-sm ... max-2xl,
 * min-[...], max-[...]), print, motion-safe / motion-reduce, contrast-more /
 * contrast-less, portrait / landscape and forced-colors. State and pseudo
 * variants (hover:, focus:, group-*, peer-*, aria-*, data-*, dark: under
 * darkMode "class", [&...]) add a selector and are not media queries.
 */
export function isMediaQueryVariant(variant: string): boolean {
  return (
    screenConditionOf(variant) !== null ||
    NON_WIDTH_MEDIA_VARIANTS.includes(variant)
  );
}

export interface ScreenReaderOnlyOptions {
  /*
   * Resolve as if the page also carried Bootstrap 3's / HTML5 Boilerplate's
   * `.sr-only{position:absolute;width:1px;height:1px;clip:rect(0,0,0,0);...}`
   * appended after Tailwind: one class, later in the cascade than any
   * utility.
   */
  withForeignSrOnlyRule?: boolean | undefined;
  // A hypothetical !important version of that rule. Neither library ships it.
  foreignSrOnlyRuleIsImportant?: boolean | undefined;
  // Whether the element has keyboard focus, for `focus:` variants.
  isFocused?: boolean | undefined;
  /*
   * The non-width media variants whose query holds (`print`,
   * `motion-reduce` ...). None by default: a screen, default preferences.
   */
  mediaConditions?: ReadonlyArray<string> | undefined;
}

interface SrOnlyContender {
  collapses: boolean;
  important: boolean;
  // Classes plus pseudo-classes: `.sr-only` is 1, `.focus\:x:focus` is 2.
  specificity: number;
  // Stylesheet position; the appended foreign sheet comes after all of it.
  precedence: number;
  // Inside one group Tailwind emits sr-only before not-sr-only.
  order: number;
}

// The state variants the resolver models: a pseudo-class that holds while focused.
const SR_ONLY_FOCUS_VARIANTS: ReadonlySet<string> = new Set<string>([
  "focus",
  "focus-visible",
]);

/*
 * The stylesheet position a media-query variant puts its utility at, or
 * null when its query does not hold here - or it is not a media query at all.
 */
function applicableMediaPrecedence(
  variant: string,
  viewportWidthInPx: number,
  options: ScreenReaderOnlyOptions | undefined,
): number | null {
  const screen: ScreenCondition | null = screenConditionOf(variant);

  if (screen) {
    if (screen.widthInPx === null) {
      return null;
    }

    // `max-sm:` is `@media not all and (min-width: 640px)`.
    const holds: boolean =
      screen.direction === "max"
        ? viewportWidthInPx < screen.widthInPx
        : viewportWidthInPx >= screen.widthInPx;

    return holds ? screenPrecedence(screen, screen.widthInPx) : null;
  }

  const precedence: number | undefined =
    NON_WIDTH_MEDIA_PRECEDENCE.get(variant);

  if (
    precedence === undefined ||
    !(options?.mediaConditions || []).includes(variant)
  ) {
    return null;
  }

  return precedence;
}

/*
 * The contender a class token puts into the cascade at this width, or null
 * when it does not apply (a query that does not hold, focus not held) or
 * carries a state the resolver does not model (hover:, group-*:, dark: ...).
 * Leaving those out is exact for the foreign-rule question: like focus:,
 * they add specificity, so a foreign `.sr-only` never decides them. A stack
 * of media queries must all hold, and sorts by the latest in Tailwind's order.
 */
function srOnlyContenderOf(
  token: string,
  viewportWidthInPx: number,
  options: ScreenReaderOnlyOptions | undefined,
): SrOnlyContender | null {
  const parts: Array<string> = splitVariants(token);
  const utility: string = parts.pop()!;

  if (utility !== "sr-only" && utility !== "not-sr-only") {
    return null;
  }

  let specificity: number = 1;
  let precedence: number = UNPREFIXED_PRECEDENCE;

  for (const variant of parts) {
    if (SR_ONLY_FOCUS_VARIANTS.has(variant)) {
      if (!options?.isFocused) {
        return null;
      }

      specificity++;
      continue;
    }

    const mediaPrecedence: number | null = applicableMediaPrecedence(
      variant,
      viewportWidthInPx,
      options,
    );

    if (mediaPrecedence === null) {
      return null;
    }

    precedence = Math.max(precedence, mediaPrecedence);
  }

  return {
    collapses: utility === "sr-only",
    important: false,
    specificity: specificity,
    precedence: precedence,
    order: utility === "sr-only" ? 0 : 1,
  };
}

function beats(challenger: SrOnlyContender, holder: SrOnlyContender): boolean {
  if (challenger.important !== holder.important) {
    return challenger.important;
  }

  if (challenger.specificity !== holder.specificity) {
    return challenger.specificity > holder.specificity;
  }

  if (challenger.precedence !== holder.precedence) {
    return challenger.precedence > holder.precedence;
  }

  return challenger.order > holder.order;
}

/**
 * Whether the element is collapsed to a 1px clip (read to screen readers
 * only) at the given width. Only the bare `sr-only` token can pull in the
 * foreign rule: with it present, the label is collapsed at every width
 * unless a more specific (focus) undo applies; `max-<bp>:sr-only` collapses
 * only below the breakpoint, foreign rule or not.
 */
export function isVisuallyCollapsed(
  classAttribute: string | null | undefined,
  viewportWidthInPx: number,
  options?: ScreenReaderOnlyOptions,
): boolean {
  const tokens: Array<string> = (classAttribute || "")
    .split(/\s+/)
    .filter(Boolean);
  let winner: SrOnlyContender | null = null;

  for (const token of tokens) {
    const contender: SrOnlyContender | null = srOnlyContenderOf(
      token,
      viewportWidthInPx,
      options,
    );

    if (contender && (!winner || beats(contender, winner))) {
      winner = contender;
    }
  }

  if (options?.withForeignSrOnlyRule && tokens.includes("sr-only")) {
    const foreign: SrOnlyContender = {
      collapses: true,
      important: Boolean(options.foreignSrOnlyRuleIsImportant),
      specificity: 1,
      precedence: Number.POSITIVE_INFINITY,
      order: 0,
    };

    if (!winner || beats(foreign, winner)) {
      winner = foreign;
    }
  }

  return winner ? winner.collapses : false;
}
