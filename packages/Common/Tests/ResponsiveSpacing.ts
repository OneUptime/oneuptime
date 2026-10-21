import {
  isVisuallyCollapsed,
  mediaPrecedenceOf,
  resolveDisplay,
  splitVariants,
} from "./ResponsiveVisibility";

/*
 * Answers "how much padding would a browser give this element at viewport
 * width W?" - and the same for scroll padding and margin - for markup styled
 * with Tailwind spacing utilities. The spacing counterpart of
 * ResponsiveVisibility.ts.
 *
 * jsdom has no stylesheet, so to it every element has no padding at any
 * width, and a test that asks the DOM cannot tell a panel whose last row sits
 * flush on its footer from one that leaves room. That is how SideOver shipped
 * `py-6 sm:py-0`, which took its bottom padding away on every screen 640px or
 * wider and left the workflow picker's last row on the footer's divider.
 * These helpers read the class attribute instead and resolve it the way the
 * cascade would.
 *
 * Scope: the padding (`p-*`), scroll padding (`scroll-p-*`) and margin
 * (`m-*`) families - all sides, an axis or one side - with no variant or
 * behind media-query variants (sm:, max-md:, min-[900px]: ...). State
 * variants (hover:, focus:, dark:, group-*: ...) are ignored, as they are in
 * ResponsiveVisibility.ts: they cannot answer a layout question.
 *
 * The precedence mirrors the stylesheet the vendored Tailwind 3.4.5 Play CDN
 * emits (checked in a browser against its output). Screens order as in
 * ResponsiveVisibility.ts - see mediaPrecedenceOf. Inside one screen a family
 * emits all sides first, then the axes, then single sides, so `p-5 py-6` is
 * 24px top and bottom and `py-6 pt-0` has no top padding, whatever order the
 * classes are written in.
 */

export type SpacingProperty = "padding" | "scroll-padding" | "margin";

// In px. Sides no utility sets are 0, which is also what `auto` scroll padding is.
export interface BoxSpacing {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

type Side = keyof BoxSpacing;

interface SpacingFamily {
  // The utility name before the side letter: `p` of `pb-6`.
  prefix: string;
  // Tailwind emits negative values (`-mb-2`) for margins only.
  allowsNegative: boolean;
  // Margins alone take `auto`; for the others Tailwind emits no rule.
  allowsAuto: boolean;
}

const SPACING_FAMILIES: Record<SpacingProperty, SpacingFamily> = {
  padding: { prefix: "p", allowsNegative: false, allowsAuto: false },
  "scroll-padding": {
    prefix: "scroll-p",
    allowsNegative: false,
    allowsAuto: false,
  },
  margin: { prefix: "m", allowsNegative: true, allowsAuto: true },
};

interface SideGroup {
  sides: Array<Side>;
  // Tailwind's emit order inside one screen; later wins.
  order: number;
}

const SIDE_GROUPS: Record<string, SideGroup> = {
  "": { sides: ["top", "right", "bottom", "left"], order: 0 },
  x: { sides: ["left", "right"], order: 1 },
  y: { sides: ["top", "bottom"], order: 1 },
  // Inline start and end, as left and right: the app is laid out left to right.
  s: { sides: ["left"], order: 2 },
  e: { sides: ["right"], order: 2 },
  t: { sides: ["top"], order: 2 },
  r: { sides: ["right"], order: 2 },
  b: { sides: ["bottom"], order: 2 },
  l: { sides: ["left"], order: 2 },
};

/*
 * Tailwind's default spacing scale, which the app does not extend (see the
 * tailwind.config in the Dashboard's index.ejs): each key is a quarter rem.
 */
const SPACING_SCALE_KEYS: ReadonlySet<string> = new Set<string>([
  "0",
  "0.5",
  "1",
  "1.5",
  "2",
  "2.5",
  "3",
  "3.5",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
  "14",
  "16",
  "20",
  "24",
  "28",
  "32",
  "36",
  "40",
  "44",
  "48",
  "52",
  "56",
  "60",
  "64",
  "72",
  "80",
  "96",
]);

const ROOT_FONT_SIZE_IN_PX: number = 16;

const ARBITRARY_LENGTH: RegExp = /^\[(\d*\.?\d+)(px|rem)\]$/;

/**
 * The length a spacing utility's value stands for, in px: a key of the
 * default scale (`6` is 1.5rem, so 24px; `px` is 1px) or an arbitrary length
 * (`[3px]`, `[1.5rem]`). NaN for what has no length before layout - `auto`,
 * or an arbitrary value that is not a plain length (`[calc(...)]`) - so any
 * arithmetic with it fails loudly. null for a value Tailwind emits no rule
 * for at all: a key the scale does not have, or `auto` outside margins.
 */
export function spacingValueInPx(
  value: string,
  property: SpacingProperty,
): number | null {
  if (value === "px") {
    return 1;
  }

  if (SPACING_SCALE_KEYS.has(value)) {
    return (parseFloat(value) * ROOT_FONT_SIZE_IN_PX) / 4;
  }

  if (value === "auto") {
    return SPACING_FAMILIES[property].allowsAuto ? NaN : null;
  }

  if (value === "[0]") {
    return 0;
  }

  const arbitrary: RegExpMatchArray | null = value.match(ARBITRARY_LENGTH);

  if (arbitrary) {
    const amount: number = parseFloat(arbitrary[1]!);

    return arbitrary[2] === "rem" ? amount * ROOT_FONT_SIZE_IN_PX : amount;
  }

  // Tailwind still emits a rule for any arbitrary value; it has no length here.
  return value.startsWith("[") && value.endsWith("]") ? NaN : null;
}

interface SpacingContender {
  token: string;
  value: number;
  important: boolean;
  precedence: number;
  order: number;
}

function beats(
  challenger: SpacingContender,
  holder: SpacingContender,
): boolean | null {
  if (challenger.important !== holder.important) {
    return challenger.important;
  }

  if (challenger.precedence !== holder.precedence) {
    return challenger.precedence > holder.precedence;
  }

  if (challenger.order !== holder.order) {
    return challenger.order > holder.order;
  }

  // The same place in the stylesheet: neither is defined to win.
  return null;
}

/**
 * The padding, scroll padding or margin Tailwind resolves for one class
 * attribute at a given viewport width, side by side, in px.
 *
 * Two utilities that set one side at the same place in the stylesheet
 * (`pb-2 pb-4`, or `ps-1 pl-2`) throw: which one wins is not defined, and
 * markup that relies on it is worth a look rather than a guess.
 */
export function resolveSpacing(
  classAttribute: string | null | undefined,
  viewportWidthInPx: number,
  property: SpacingProperty,
): BoxSpacing {
  const family: SpacingFamily = SPACING_FAMILIES[property];
  const pattern: RegExp = new RegExp(
    `^(!?)(-?)${family.prefix}([xytrblse]?)-(.+)$`,
  );
  const winners: Partial<Record<Side, SpacingContender>> = {};

  const tokens: Array<string> = (classAttribute || "")
    .split(/\s+/)
    .filter(Boolean);

  for (const token of tokens) {
    const parts: Array<string> = splitVariants(token);
    const utility: string = parts.pop()!;
    const match: RegExpMatchArray | null = utility.match(pattern);

    if (!match) {
      continue;
    }

    const isImportant: boolean = match[1] === "!";
    const isNegative: boolean = match[2] === "-";
    const group: SideGroup | undefined = SIDE_GROUPS[match[3] || ""];
    const length: number | null = spacingValueInPx(match[4] || "", property);

    if (!group || length === null || (isNegative && !family.allowsNegative)) {
      // Tailwind emits no rule for it.
      continue;
    }

    const precedence: number | null = mediaPrecedenceOf(
      parts,
      viewportWidthInPx,
    );

    if (precedence === null) {
      continue;
    }

    const contender: SpacingContender = {
      token: token,
      // `-mb-0` is 0, not -0.
      value: isNegative && length !== 0 ? -length : length,
      important: isImportant,
      precedence: precedence,
      order: group.order,
    };

    for (const side of group.sides) {
      const holder: SpacingContender | undefined = winners[side];

      if (!holder) {
        winners[side] = contender;
        continue;
      }

      const challengerWins: boolean | null = beats(contender, holder);

      if (challengerWins === null) {
        if (!Object.is(contender.value, holder.value)) {
          throw new Error(
            `"${holder.token}" and "${contender.token}" both set the ${side} ${property} at the same place in the stylesheet, so which one wins is not defined.`,
          );
        }

        continue;
      }

      if (challengerWins) {
        winners[side] = contender;
      }
    }
  }

  return {
    top: winners.top?.value ?? 0,
    right: winners.right?.value ?? 0,
    bottom: winners.bottom?.value ?? 0,
    left: winners.left?.value ?? 0,
  };
}

export function resolvePadding(
  classAttribute: string | null | undefined,
  viewportWidthInPx: number,
): BoxSpacing {
  return resolveSpacing(classAttribute, viewportWidthInPx, "padding");
}

export function resolveScrollPadding(
  classAttribute: string | null | undefined,
  viewportWidthInPx: number,
): BoxSpacing {
  return resolveSpacing(classAttribute, viewportWidthInPx, "scroll-padding");
}

export function resolveMargin(
  classAttribute: string | null | undefined,
  viewportWidthInPx: number,
): BoxSpacing {
  return resolveSpacing(classAttribute, viewportWidthInPx, "margin");
}

// `<button class="...">`, for messages that point at the markup.
export function describeElement(element: Element): string {
  const classAttribute: string | null = element.getAttribute("class");

  return `<${element.tagName.toLowerCase()}${
    classAttribute ? ` class="${classAttribute}"` : ""
  }>`;
}

const OUT_OF_FLOW_TOKENS: ReadonlyArray<string> = ["absolute", "fixed"];

const NEVER_RENDERED_TAGS: ReadonlyArray<string> = [
  "SCRIPT",
  "STYLE",
  "TEMPLATE",
];

/*
 * Whether a node takes up room in its parent's flow at this width: not a
 * script, style or template, not display none, not positioned out of flow
 * (sr-only is, too), and for text, not just the whitespace between tags.
 */
function isLaidOut(node: ChildNode, viewportWidthInPx: number): boolean {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent || "").trim().length > 0;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }

  const element: Element = node as Element;
  const classAttribute: string | null = element.getAttribute("class");
  const tokens: Array<string> = (classAttribute || "").split(/\s+/);

  return !(
    NEVER_RENDERED_TAGS.includes(element.tagName) ||
    element.hasAttribute("hidden") ||
    resolveDisplay(classAttribute, viewportWidthInPx) === "hidden" ||
    isVisuallyCollapsed(classAttribute, viewportWidthInPx) ||
    OUT_OF_FLOW_TOKENS.some((token: string): boolean => {
      return tokens.includes(token);
    })
  );
}

// `border`, `border-2`, `border-b`, `border-y-4` ... - not a colour like `border-gray-200`.
const BOTTOM_BORDER_WIDTH: RegExp = /^border(-[by])?(-(\d+|\[[^\]]+\]))?$/;

function hasBottomBorder(element: Element, viewportWidthInPx: number): boolean {
  return (element.getAttribute("class") || "")
    .split(/\s+/)
    .filter(Boolean)
    .some((token: string): boolean => {
      const parts: Array<string> = splitVariants(token);
      const utility: string = parts.pop()!;
      const match: RegExpMatchArray | null = utility.match(BOTTOM_BORDER_WIDTH);

      return (
        Boolean(match) &&
        match![3] !== "0" &&
        mediaPrecedenceOf(parts, viewportWidthInPx) !== null
      );
    });
}

/*
 * A parent that lays its children out in a formatting context of its own
 * keeps their margins inside it: flex and grid items' margins never collapse
 * with the container's, and a flow-root or a scroller is a new block
 * formatting context.
 */
const CONTAINING_DISPLAYS: ReadonlyArray<string> = [
  "flex",
  "inline-flex",
  "grid",
  "inline-grid",
  "flow-root",
];

const CONTAINING_OVERFLOW: RegExp = /^overflow(-[xy])?-(hidden|auto|scroll)$/;

function keepsMarginsInside(
  element: Element,
  viewportWidthInPx: number,
): boolean {
  const classAttribute: string | null = element.getAttribute("class");

  return (
    CONTAINING_DISPLAYS.includes(
      resolveDisplay(classAttribute, viewportWidthInPx) || "",
    ) ||
    (classAttribute || "")
      .split(/\s+/)
      .filter(Boolean)
      .some((token: string): boolean => {
        const parts: Array<string> = splitVariants(token);

        return (
          CONTAINING_OVERFLOW.test(parts.pop()!) &&
          mediaPrecedenceOf(parts, viewportWidthInPx) !== null
        );
      })
  );
}

/**
 * How far the scrolling content of `scrollContainer` (an ancestor) runs on
 * below `element` at this width: the bottom padding of every element in
 * between, the container's own included, plus a bottom margin wherever it is
 * kept inside its parent. That is the gap a browser leaves under the element
 * once the container is scrolled to the end.
 *
 * It answers only when nothing is laid out below the element, which it
 * checks: the element, and each ancestor up to the container, is the last
 * thing in its parent's flow. What it cannot work out without a layout - a
 * bottom border in between, a margin that collapses through its parent -
 * throws, naming the markup, rather than guess. It measures from the
 * element's own box, so a margin on the element's last child that escapes
 * through it is not counted: measure from the innermost last box when that
 * matters. Heights are not looked at: a fixed or minimum height in between
 * can only add room, never take it away.
 */
export function resolveSpaceBelowInPx(
  element: Element,
  scrollContainer: Element,
  viewportWidthInPx: number,
): number {
  if (element === scrollContainer || !scrollContainer.contains(element)) {
    throw new Error(
      `${describeElement(element)} is not inside ${describeElement(scrollContainer)}.`,
    );
  }

  let space: number = 0;
  let node: Element = element;

  while (node !== scrollContainer) {
    const parent: Element = node.parentElement!;

    let sibling: ChildNode | null = node.nextSibling;

    while (sibling) {
      if (isLaidOut(sibling, viewportWidthInPx)) {
        throw new Error(
          `${
            sibling.nodeType === 1
              ? describeElement(sibling as Element)
              : `the text "${(sibling.textContent || "").trim()}"`
          } is laid out below ${describeElement(node)}.`,
        );
      }

      sibling = sibling.nextSibling;
    }

    const parentPadding: number = resolvePadding(
      parent.getAttribute("class"),
      viewportWidthInPx,
    ).bottom;
    const margin: number = resolveMargin(
      node.getAttribute("class"),
      viewportWidthInPx,
    ).bottom;

    if (margin !== 0) {
      const isKeptInside: boolean =
        parent === scrollContainer ||
        parentPadding !== 0 ||
        keepsMarginsInside(parent, viewportWidthInPx);

      if (!isKeptInside) {
        throw new Error(
          `The bottom margin of ${describeElement(node)} collapses through ${describeElement(parent)}, which this does not model.`,
        );
      }

      space += margin;
    }

    if (
      parent !== scrollContainer &&
      hasBottomBorder(parent, viewportWidthInPx)
    ) {
      throw new Error(
        `${describeElement(parent)} draws a bottom border below ${describeElement(element)}, which this does not model.`,
      );
    }

    space += parentPadding;
    node = parent;
  }

  return space;
}
