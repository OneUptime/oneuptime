import { resolveFlex } from "./ResponsiveFlexLayout";
import {
  mediaPrecedenceOf,
  resolveDisplay,
  splitVariants,
} from "./ResponsiveVisibility";

/*
 * Answers "does this box run to the bottom of the box it is in, at viewport
 * width W?" for markup styled with Tailwind utilities - the height
 * counterpart of ResponsiveFlexLayout.ts.
 *
 * jsdom lays nothing out, so to it a card that ends two thirds of the way
 * down the grid row it shares with a taller card looks exactly like one that
 * fills the row. That is how Home's "Needs attention" left bare page under
 * it beside "Your project" ("We have quite a bit of empty space between
 * cards"). These helpers read the class attributes of a box and of its
 * parent and say whether the box takes its parent's height, as the cascade
 * and the CSS layout rules would:
 *
 * - In a grid, or in a flex row, an item takes the height of its row unless
 *   it or its container aligns it (self-start, items-center ...): stretch is
 *   the default.
 * - In a flex column an item takes the height its siblings leave only when
 *   it grows (flex-1, flex-auto, grow) - by a class of its own (last:flex-1
 *   included), or by its parent's child variant ([&>*:last-child]:flex-1,
 *   [&>*]:flex-1, *:flex-1) when that variant selects it.
 * - Anywhere else (a block box) only height: 100% (h-full) does. It needs a
 *   parent whose height is known, which describeHeightFillChain checks one
 *   box up.
 *
 * Scope: those utilities, with no variant or behind screen variants (sm:,
 * max-md: ...). State variants (hover:, dark: ...) say nothing about layout
 * and are ignored, as in the other resolvers.
 */

interface UtilityFamily {
  // Utility -> CSS value, in Tailwind 3.4.5's emit order (later wins).
  utilities: Array<[string, string]>;
  initial: string;
}

const ALIGN_SELF: UtilityFamily = {
  utilities: [
    ["self-auto", "auto"],
    ["self-start", "flex-start"],
    ["self-end", "flex-end"],
    ["self-center", "center"],
    ["self-stretch", "stretch"],
    ["self-baseline", "baseline"],
  ],
  initial: "auto",
};

/*
 * flex-grow, as the `flex` shorthands and the grow utilities set it. The
 * shorthands are emitted before the grow utilities, so `flex-1 grow-0` does
 * not grow.
 */
const FLEX_GROW: UtilityFamily = {
  utilities: [
    ["flex-1", "1"],
    ["flex-auto", "1"],
    ["flex-initial", "0"],
    ["flex-none", "0"],
    ["grow", "1"],
    ["grow-0", "0"],
  ],
  initial: "0",
};

/*
 * height, as far as filling goes: 100% fills, auto ends with the content.
 * A fixed height (h-9, h-[200px]) is neither, and reads as "fixed".
 */
const HEIGHT: UtilityFamily = {
  utilities: [
    ["h-auto", "auto"],
    ["h-full", "100%"],
  ],
  initial: "auto",
};

const FIXED_HEIGHT: RegExp = /^h-(?!auto$|full$)/;

/*
 * The child variants a container uses to style its children, and which
 * child each one selects.
 */
type ChildSelector = (child: Element) => boolean;

const CHILD_VARIANTS: Record<string, ChildSelector> = {
  "[&>*]": (): boolean => {
    return true;
  },
  "*": (): boolean => {
    return true;
  },
  "[&>*:last-child]": (child: Element): boolean => {
    return child.parentElement?.lastElementChild === child;
  },
  "[&>*:first-child]": (child: Element): boolean => {
    return child.parentElement?.firstElementChild === child;
  },
  "[&>*:only-child]": (child: Element): boolean => {
    return child.parentElement?.children.length === 1;
  },
};

// Variants on an element's own classes that depend on where it sits.
const OWN_STRUCTURAL_VARIANTS: Record<string, ChildSelector> = {
  last: (element: Element): boolean => {
    return element.parentElement?.lastElementChild === element;
  },
  first: (element: Element): boolean => {
    return element.parentElement?.firstElementChild === element;
  },
  only: (element: Element): boolean => {
    return element.parentElement?.children.length === 1;
  },
};

interface Contender {
  value: string;
  precedence: number;
  order: number;
}

/*
 * The winner of one family among class tokens at a width. Each token is
 * given with the structural variants it still has to pass (already
 * checked by the caller) removed.
 */
function resolveFamily(
  tokens: Array<Array<string>>,
  viewportWidthInPx: number,
  family: UtilityFamily,
): string {
  let winner: Contender | null = null;

  for (const parts of tokens) {
    const variants: Array<string> = parts.slice(0, -1);
    const utility: string = parts[parts.length - 1]!;
    const order: number = family.utilities.findIndex(
      (entry: [string, string]): boolean => {
        return entry[0] === utility;
      },
    );

    if (order === -1) {
      continue;
    }

    const precedence: number | null = mediaPrecedenceOf(
      variants,
      viewportWidthInPx,
    );

    if (precedence === null) {
      continue;
    }

    if (
      !winner ||
      precedence > winner.precedence ||
      (precedence === winner.precedence && order >= winner.order)
    ) {
      winner = {
        value: family.utilities[order]![1],
        precedence: precedence,
        order: order,
      };
    }
  }

  return winner ? winner.value : family.initial;
}

function tokensOf(element: Element): Array<string> {
  return (element.getAttribute("class") || "").split(/\s+/).filter(Boolean);
}

/*
 * The element's own class tokens, split into variants and utility, with
 * the structural variants it passes (last:, first:, only:) taken off and
 * the tokens whose structural variant it does not pass left out.
 */
function ownTokens(element: Element): Array<Array<string>> {
  const result: Array<Array<string>> = [];

  for (const token of tokensOf(element)) {
    const parts: Array<string> = splitVariants(token);
    const kept: Array<string> = [];
    let applies: boolean = true;

    for (const part of parts.slice(0, -1)) {
      const selector: ChildSelector | undefined =
        OWN_STRUCTURAL_VARIANTS[part];

      if (selector) {
        applies = applies && selector(element);
      } else {
        kept.push(part);
      }
    }

    if (applies) {
      result.push([...kept, parts[parts.length - 1]!]);
    }
  }

  return result;
}

/*
 * What the parent's child variants give this element: `[&>*:last-child]:
 * flex-1` on the parent reads as `flex-1` on its last child.
 */
function tokensFromParent(element: Element): Array<Array<string>> {
  const parent: Element | null = element.parentElement;
  const result: Array<Array<string>> = [];

  if (!parent) {
    return result;
  }

  for (const token of tokensOf(parent)) {
    const parts: Array<string> = splitVariants(token);
    const variants: Array<string> = parts.slice(0, -1);
    const childVariantIndex: number = variants.findIndex(
      (variant: string): boolean => {
        return Boolean(CHILD_VARIANTS[variant]);
      },
    );

    if (childVariantIndex === -1) {
      continue;
    }

    if (!CHILD_VARIANTS[variants[childVariantIndex]!]!(element)) {
      continue;
    }

    result.push([
      ...variants.filter((_variant: string, index: number): boolean => {
        return index !== childVariantIndex;
      }),
      parts[parts.length - 1]!,
    ]);
  }

  return result;
}

// Every token that styles the element: its own, and its parent's for it.
function effectiveTokens(element: Element): Array<Array<string>> {
  return [...ownTokens(element), ...tokensFromParent(element)];
}

export function resolveAlignSelf(
  element: Element,
  viewportWidthInPx: number,
): string {
  return resolveFamily(
    effectiveTokens(element),
    viewportWidthInPx,
    ALIGN_SELF,
  );
}

export function resolveFlexGrow(
  element: Element,
  viewportWidthInPx: number,
): number {
  return Number(
    resolveFamily(effectiveTokens(element), viewportWidthInPx, FLEX_GROW),
  );
}

// "100%", "auto", or "fixed" for any other height utility that applies.
export function resolveHeight(
  element: Element,
  viewportWidthInPx: number,
): string {
  const tokens: Array<Array<string>> = effectiveTokens(element);
  const resolved: string = resolveFamily(tokens, viewportWidthInPx, HEIGHT);

  if (resolved !== "auto") {
    return resolved;
  }

  const hasFixedHeight: boolean = tokens.some(
    (parts: Array<string>): boolean => {
      return (
        FIXED_HEIGHT.test(parts[parts.length - 1]!) &&
        mediaPrecedenceOf(parts.slice(0, -1), viewportWidthInPx) !== null
      );
    },
  );

  return hasFixedHeight ? "fixed" : "auto";
}

// A short name for an element in a message: its test id, or its tag.
export function describeBox(element: Element): string {
  const testId: string | null = element.getAttribute("data-testid");

  return testId
    ? `[data-testid="${testId}"]`
    : `<${element.tagName.toLowerCase()} class="${
        element.getAttribute("class") || ""
      }">`;
}

/*
 * Why the element does not run to the bottom of its parent at this width,
 * or null when it does.
 */
export function describeHeightFill(
  element: Element,
  viewportWidthInPx: number,
): string | null {
  const parent: Element | null = element.parentElement;
  const name: string = describeBox(element);

  if (!parent) {
    return `${name} has no parent to fill`;
  }

  const display: string | null = resolveDisplay(
    parent.getAttribute("class"),
    viewportWidthInPx,
  );
  const height: string = resolveHeight(element, viewportWidthInPx);

  if (height === "fixed") {
    return `${name} has a fixed height`;
  }

  const isGrid: boolean = display === "grid" || display === "inline-grid";
  const isFlex: boolean = display === "flex" || display === "inline-flex";
  const direction: string = isFlex
    ? resolveFlex(
        parent.getAttribute("class"),
        viewportWidthInPx,
        "flex-direction",
      )
    : "";

  if (isGrid || (isFlex && direction.startsWith("row"))) {
    if (height === "100%") {
      return null;
    }

    const alignSelf: string = resolveAlignSelf(element, viewportWidthInPx);

    if (alignSelf !== "auto") {
      return alignSelf === "stretch"
        ? null
        : `${name} is aligned to ${alignSelf} (align-self), so it ends where its content ends`;
    }

    const alignItems: string = resolveFlex(
      parent.getAttribute("class"),
      viewportWidthInPx,
      "align-items",
    );

    return alignItems === "stretch"
      ? null
      : `${describeBox(parent)} aligns its items to ${alignItems} (align-items), so ${name} ends where its content ends`;
  }

  if (isFlex) {
    /*
     * A flex column: an item that grows takes the room its siblings leave,
     * and so does an only child as tall as the column.
     */
    if (resolveFlexGrow(element, viewportWidthInPx) > 0) {
      return null;
    }

    return height === "100%" && parent.children.length === 1
      ? null
      : `${name} does not grow in its flex column (flex-1, or [&>*:last-child]:flex-1 on the column), so it ends where its content ends`;
  }

  return height === "100%"
    ? null
    : `${name} is a block with an auto height inside ${describeBox(
        parent,
      )}, so it ends where its content ends (h-full, or a flex or grid parent)`;
}

/*
 * Every reason the box `from` does not run to the bottom of its ancestor
 * `upTo`, one per box between them that ends early - empty when it fills it
 * all the way.
 */
export function describeHeightFillChain(
  from: Element,
  upTo: Element,
  viewportWidthInPx: number,
): Array<string> {
  const reasons: Array<string> = [];

  if (!upTo.contains(from) || upTo === from) {
    return [`${describeBox(upTo)} does not hold ${describeBox(from)}`];
  }

  let current: Element = from;

  while (current !== upTo) {
    const reason: string | null = describeHeightFill(
      current,
      viewportWidthInPx,
    );

    if (reason) {
      reasons.push(reason);
    }

    current = current.parentElement!;
  }

  return reasons;
}
