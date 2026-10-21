import { mediaPrecedenceOf, splitVariants } from "./ResponsiveVisibility";

/*
 * Answers "how would a browser lay out this flex container (or item) at
 * viewport width W?" for markup styled with Tailwind flex utilities: its
 * direction, whether it wraps, how it places its items along and across the
 * line. The flex counterpart of ResponsiveVisibility.ts and
 * ResponsiveSpacing.ts.
 *
 * jsdom has no stylesheet, so to it a header whose actions drop under the
 * title at the left on every desktop looks exactly like one that keeps them
 * at the right edge. That is how the overview pages' "stacked" card header
 * shipped Edit under the description, at the left, at every width ("Why are
 * edit buttons not on the right?"). These helpers read the class attribute
 * and resolve it the way the cascade would.
 *
 * Scope: flex-direction, flex-wrap, justify-content and align-items, with no
 * variant or behind media-query variants (sm:, max-md:, min-[900px]: ...).
 * State and arbitrary variants (hover:, dark:, [&>button]: ...) are ignored,
 * as they are in the other two resolvers: they cannot answer a layout
 * question. Screens order as in ResponsiveVisibility.ts (mediaPrecedenceOf);
 * inside one screen a family keeps Tailwind 3.4.5's emit order, so the later
 * utility of the family wins, whatever order the classes are written in.
 */

export type FlexProperty =
  | "flex-direction"
  | "flex-wrap"
  | "justify-content"
  | "align-items";

interface FlexFamily {
  // Utility -> CSS value, in Tailwind's emit order (later wins).
  utilities: Array<[string, string]>;
  // What the property is when no utility sets it.
  initial: string;
}

const FLEX_FAMILIES: Record<FlexProperty, FlexFamily> = {
  "flex-direction": {
    utilities: [
      ["flex-row", "row"],
      ["flex-row-reverse", "row-reverse"],
      ["flex-col", "column"],
      ["flex-col-reverse", "column-reverse"],
    ],
    initial: "row",
  },
  "flex-wrap": {
    utilities: [
      ["flex-wrap", "wrap"],
      ["flex-wrap-reverse", "wrap-reverse"],
      ["flex-nowrap", "nowrap"],
    ],
    initial: "nowrap",
  },
  "justify-content": {
    utilities: [
      ["justify-normal", "normal"],
      ["justify-start", "flex-start"],
      ["justify-end", "flex-end"],
      ["justify-center", "center"],
      ["justify-between", "space-between"],
      ["justify-around", "space-around"],
      ["justify-evenly", "space-evenly"],
      ["justify-stretch", "stretch"],
    ],
    initial: "normal",
  },
  "align-items": {
    utilities: [
      ["items-start", "flex-start"],
      ["items-end", "flex-end"],
      ["items-center", "center"],
      ["items-baseline", "baseline"],
      ["items-stretch", "stretch"],
    ],
    initial: "stretch",
  },
};

/**
 * The value Tailwind resolves for one flex property of one class attribute
 * at a given viewport width: "row" / "column", "wrap" / "nowrap",
 * "flex-end", "center" ... - the property's initial value when no utility
 * sets it.
 */
export function resolveFlex(
  classAttribute: string | null | undefined,
  viewportWidthInPx: number,
  property: FlexProperty,
): string {
  const family: FlexFamily = FLEX_FAMILIES[property];
  let winner: string = family.initial;
  let winningImportance: boolean = false;
  let winningPrecedence: number = -1;
  let winningOrder: number = -1;

  const tokens: Array<string> = (classAttribute || "")
    .split(/\s+/)
    .filter(Boolean);

  for (const token of tokens) {
    const parts: Array<string> = splitVariants(token);
    let utility: string = parts.pop()!;
    const isImportant: boolean = utility.startsWith("!");

    if (isImportant) {
      utility = utility.slice(1);
    }

    const order: number = family.utilities.findIndex(
      (entry: [string, string]) => {
        return entry[0] === utility;
      },
    );

    if (order === -1) {
      continue;
    }

    const precedence: number | null = mediaPrecedenceOf(
      parts,
      viewportWidthInPx,
    );

    if (precedence === null) {
      continue;
    }

    const beatsHolder: boolean =
      isImportant !== winningImportance
        ? isImportant
        : precedence !== winningPrecedence
          ? precedence > winningPrecedence
          : order >= winningOrder;

    if (beatsHolder) {
      winner = family.utilities[order]![1];
      winningImportance = isImportant;
      winningPrecedence = precedence;
      winningOrder = order;
    }
  }

  return winner;
}

/*
 * A flex container's main axis runs across the page - left to right - at
 * this width, so its items sit side by side rather than one under the other.
 */
export function isRowAtWidth(
  element: Element | null,
  viewportWidthInPx: number,
): boolean {
  return (
    Boolean(element) &&
    resolveFlex(
      element!.getAttribute("class"),
      viewportWidthInPx,
      "flex-direction",
    ) === "row"
  );
}
