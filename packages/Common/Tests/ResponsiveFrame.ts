import { mediaPrecedenceOf, splitVariants } from "./ResponsiveVisibility";

/*
 * Answers "what frame would a browser draw round this element at viewport
 * width W?" - the width of each side's border, the radius of each corner
 * and the shadow - for markup styled with Tailwind utilities. The frame
 * counterpart of ResponsiveSpacing.ts, and read the same way: jsdom has no
 * stylesheet, so to it a box drawn only from sm up and one drawn at every
 * width look alike. A card that is a section on a phone only
 * (Card/CardSectionsOnPhones) is held to "the card it always was, from sm
 * up" with these.
 *
 * Scope: the border width family (border, border-x/y, border-s/e/t/r/b/l;
 * 1px, 0, 2, 4, 8 or an arbitrary px length), the radius family (rounded,
 * rounded-s/e/t/r/b/l, rounded-ss/se/ee/es/tl/tr/br/bl; none to full, or an
 * arbitrary px length) and the shadow family (shadow, shadow-sm ...
 * shadow-none), with no variant or behind media-query variants (sm:,
 * max-md: ...). State variants (hover:, focus:, dark: ...) are ignored, as
 * they are in ResponsiveVisibility.ts: they cannot answer a layout question.
 * Start and end are read as left and right: the app's reading-direction
 * plugin (UI/Styles/TailwindReadingDirection.js) writes left and right as
 * the start and the end of the line, which they are on a left-to-right
 * page - the one these answer for.
 *
 * The precedence mirrors the stylesheet Tailwind 3.4.5 emits: screens order
 * as in ResponsiveVisibility.ts (mediaPrecedenceOf), and inside one screen a
 * family emits all sides first, then the axes (for corners: the sides),
 * then single sides (the single corners), whatever order the classes are
 * written in. Two utilities that set one side at the same place with
 * different values throw, as ResponsiveSpacing.ts does: which one wins is
 * not defined.
 */

export interface BorderWidths {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface CornerRadii {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

export interface ResolvedFrame {
  border: BorderWidths;
  radius: CornerRadii;
  // The shadow utility that applies (shadow-sm ...), or null for none.
  shadow: string | null;
}

interface Contender {
  token: string;
  value: number;
  important: boolean;
  precedence: number;
  order: number;
}

interface SideGroup<Side extends string> {
  sides: Array<Side>;
  // Tailwind's emit order inside one screen; later wins.
  order: number;
}

type BorderSide = keyof BorderWidths;
type Corner = keyof CornerRadii;

const BORDER_GROUPS: Record<string, SideGroup<BorderSide>> = {
  "": { sides: ["top", "right", "bottom", "left"], order: 0 },
  x: { sides: ["left", "right"], order: 1 },
  y: { sides: ["top", "bottom"], order: 1 },
  s: { sides: ["left"], order: 2 },
  e: { sides: ["right"], order: 2 },
  t: { sides: ["top"], order: 2 },
  r: { sides: ["right"], order: 2 },
  b: { sides: ["bottom"], order: 2 },
  l: { sides: ["left"], order: 2 },
};

const CORNER_GROUPS: Record<string, SideGroup<Corner>> = {
  "": {
    sides: ["topLeft", "topRight", "bottomRight", "bottomLeft"],
    order: 0,
  },
  s: { sides: ["topLeft", "bottomLeft"], order: 1 },
  e: { sides: ["topRight", "bottomRight"], order: 1 },
  t: { sides: ["topLeft", "topRight"], order: 1 },
  r: { sides: ["topRight", "bottomRight"], order: 1 },
  b: { sides: ["bottomRight", "bottomLeft"], order: 1 },
  l: { sides: ["topLeft", "bottomLeft"], order: 1 },
  ss: { sides: ["topLeft"], order: 2 },
  se: { sides: ["topRight"], order: 2 },
  ee: { sides: ["bottomRight"], order: 2 },
  es: { sides: ["bottomLeft"], order: 2 },
  tl: { sides: ["topLeft"], order: 2 },
  tr: { sides: ["topRight"], order: 2 },
  br: { sides: ["bottomRight"], order: 2 },
  bl: { sides: ["bottomLeft"], order: 2 },
};

// border, border-t, border-y-2, border-l-4, border-[3px] - never a colour.
const BORDER_WIDTH_UTILITY: RegExp =
  /^(!?)border(?:-(x|y|s|e|t|r|b|l))?(?:-(0|2|4|8|\[\d+(?:\.\d+)?px\]))?$/;

const BORDER_WIDTHS_IN_PX: Record<string, number> = {
  "": 1,
  "0": 0,
  "2": 2,
  "4": 4,
  "8": 8,
};

// rounded, rounded-xl, rounded-t-lg, rounded-tl-none, rounded-[10px].
const RADIUS_UTILITY: RegExp =
  /^(!?)rounded(?:-(ss|se|ee|es|tl|tr|br|bl|s|e|t|r|b|l))?(?:-(none|sm|md|lg|xl|2xl|3xl|full|\[\d+(?:\.\d+)?px\]))?$/;

const RADII_IN_PX: Record<string, number> = {
  none: 0,
  sm: 2,
  "": 4,
  md: 6,
  lg: 8,
  xl: 12,
  "2xl": 16,
  "3xl": 24,
  full: 9999,
};

const SHADOW_UTILITY: RegExp = /^(!?)shadow(?:-(sm|md|lg|xl|2xl|inner|none))?$/;

const ARBITRARY_PX: RegExp = /^\[(\d+(?:\.\d+)?)px\]$/;

function lengthOf(value: string, scale: Record<string, number>): number {
  const arbitrary: RegExpMatchArray | null = value.match(ARBITRARY_PX);

  if (arbitrary) {
    return parseFloat(arbitrary[1]!);
  }

  return scale[value]!;
}

function beats(challenger: Contender, holder: Contender): boolean | null {
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

function tokensOf(classAttribute: string | null | undefined): Array<string> {
  return (classAttribute || "").split(/\s+/).filter(Boolean);
}

function resolveSides<Side extends string>(options: {
  classAttribute: string | null | undefined;
  viewportWidthInPx: number;
  pattern: RegExp;
  groups: Record<string, SideGroup<Side>>;
  allSides: Array<Side>;
  valueOf: (value: string) => number;
  what: string;
}): Record<Side, number> {
  const winners: Partial<Record<Side, Contender>> = {};

  for (const token of tokensOf(options.classAttribute)) {
    const parts: Array<string> = splitVariants(token);
    const utility: string = parts.pop()!;
    const match: RegExpMatchArray | null = utility.match(options.pattern);

    if (!match) {
      continue;
    }

    const precedence: number | null = mediaPrecedenceOf(
      parts,
      options.viewportWidthInPx,
    );

    if (precedence === null) {
      continue;
    }

    const group: SideGroup<Side> = options.groups[match[2] || ""]!;
    const contender: Contender = {
      token: token,
      value: options.valueOf(match[3] || ""),
      important: match[1] === "!",
      precedence: precedence,
      order: group.order,
    };

    for (const side of group.sides) {
      const holder: Contender | undefined = winners[side];

      if (!holder) {
        winners[side] = contender;
        continue;
      }

      const challengerWins: boolean | null = beats(contender, holder);

      if (challengerWins === null) {
        if (contender.value !== holder.value) {
          throw new Error(
            `"${holder.token}" and "${contender.token}" both set the ${side} ${options.what} at the same place in the stylesheet, so which one wins is not defined.`,
          );
        }

        continue;
      }

      if (challengerWins) {
        winners[side] = contender;
      }
    }
  }

  const resolved: Partial<Record<Side, number>> = {};

  for (const side of options.allSides) {
    resolved[side] = winners[side]?.value ?? 0;
  }

  return resolved as Record<Side, number>;
}

// The width of each side's border, in px: 0 where no utility draws one.
export function resolveBorderWidths(
  classAttribute: string | null | undefined,
  viewportWidthInPx: number,
): BorderWidths {
  return resolveSides<BorderSide>({
    classAttribute: classAttribute,
    viewportWidthInPx: viewportWidthInPx,
    pattern: BORDER_WIDTH_UTILITY,
    groups: BORDER_GROUPS,
    allSides: ["top", "right", "bottom", "left"],
    valueOf: (value: string): number => {
      return lengthOf(value, BORDER_WIDTHS_IN_PX);
    },
    what: "border width",
  });
}

// The radius of each corner, in px: 0 where no utility rounds it.
export function resolveCornerRadii(
  classAttribute: string | null | undefined,
  viewportWidthInPx: number,
): CornerRadii {
  return resolveSides<Corner>({
    classAttribute: classAttribute,
    viewportWidthInPx: viewportWidthInPx,
    pattern: RADIUS_UTILITY,
    groups: CORNER_GROUPS,
    allSides: ["topLeft", "topRight", "bottomRight", "bottomLeft"],
    valueOf: (value: string): number => {
      return lengthOf(value, RADII_IN_PX);
    },
    what: "corner radius",
  });
}

/*
 * The shadow utility that applies (shadow, shadow-sm ...), or null when none
 * does or shadow-none wins.
 */
export function resolveShadow(
  classAttribute: string | null | undefined,
  viewportWidthInPx: number,
): string | null {
  let winner: Contender | null = null;
  let winnerUtility: string | null = null;

  for (const token of tokensOf(classAttribute)) {
    const parts: Array<string> = splitVariants(token);
    const utility: string = parts.pop()!;
    const match: RegExpMatchArray | null = utility.match(SHADOW_UTILITY);

    if (!match) {
      continue;
    }

    const precedence: number | null = mediaPrecedenceOf(
      parts,
      viewportWidthInPx,
    );

    if (precedence === null) {
      continue;
    }

    const name: string = utility.replace(/^!/, "");
    const contender: Contender = {
      token: token,
      value: 0,
      important: match[1] === "!",
      precedence: precedence,
      order: 0,
    };

    if (!winner) {
      winner = contender;
      winnerUtility = name;
      continue;
    }

    const challengerWins: boolean | null = beats(contender, winner);

    if (challengerWins === null) {
      if (name !== winnerUtility) {
        throw new Error(
          `"${winner.token}" and "${contender.token}" both set the shadow at the same place in the stylesheet, so which one wins is not defined.`,
        );
      }

      continue;
    }

    if (challengerWins) {
      winner = contender;
      winnerUtility = name;
    }
  }

  return winnerUtility === "shadow-none" ? null : winnerUtility;
}

export function resolveFrame(
  classAttribute: string | null | undefined,
  viewportWidthInPx: number,
): ResolvedFrame {
  return {
    border: resolveBorderWidths(classAttribute, viewportWidthInPx),
    radius: resolveCornerRadii(classAttribute, viewportWidthInPx),
    shadow: resolveShadow(classAttribute, viewportWidthInPx),
  };
}
