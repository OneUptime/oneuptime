/*
 * How well a Tailwind text class reads on a Tailwind ground class, as WCAG
 * counts contrast - so a test can hold "these words can be read" and not the
 * name of a class.
 *
 * jsdom draws nothing: an element has the classes it was given and no
 * colour. So the classes are looked up in Tailwind's default palette, which
 * is what the Dashboard's light theme is. The dark theme's colours are
 * Theme.css's own, and the browser suites measure those as they are drawn.
 *
 * Only the shades the tests meet are listed. A class that is not here is an
 * error, not a guess.
 *
 * What it reads is an element's own solid colours: `text-gray-500`,
 * `bg-indigo-50`. A variant's colour (`hover:bg-gray-50`) is not what is
 * drawn at rest and is passed over. A see-through one (`bg-white/90`) is
 * drawn mixed with what is behind it, which this does not work out: it is
 * refused, like a shade that is not listed, and never read as something
 * else.
 */

export const TAILWIND_COLOURS: Record<string, string> = {
  white: "#ffffff",
  black: "#000000",
  "gray-50": "#f9fafb",
  "gray-100": "#f3f4f6",
  "gray-200": "#e5e7eb",
  "gray-300": "#d1d5db",
  "gray-400": "#9ca3af",
  "gray-500": "#6b7280",
  "gray-600": "#4b5563",
  "gray-700": "#374151",
  "gray-800": "#1f2937",
  "gray-900": "#111827",
  "indigo-50": "#eef2ff",
  "indigo-100": "#e0e7ff",
  "indigo-200": "#c7d2fe",
  "indigo-500": "#6366f1",
  "indigo-600": "#4f46e5",
  "indigo-700": "#4338ca",
  "indigo-800": "#3730a3",
  "amber-50": "#fffbeb",
  "amber-100": "#fef3c7",
  "amber-200": "#fde68a",
  "amber-500": "#f59e0b",
  "amber-600": "#d97706",
  "amber-700": "#b45309",
  "amber-800": "#92400e",
  "amber-900": "#78350f",
  "red-50": "#fef2f2",
  "red-600": "#dc2626",
  "red-700": "#b91c1c",
};

// What WCAG AA asks of text smaller than 18px (or 14px bold).
export const AA_TEXT_CONTRAST: number = 4.5;

const COLOUR_CLASS: RegExp = /^(?:text|bg)-([a-z]+(?:-\d{2,3})?)$/;

export type ColourOfClassFunction = (className: string) => string;

/** The hex colour of "text-gray-500" or "bg-indigo-50". */
export const colourOfClass: ColourOfClassFunction = (
  className: string,
): string => {
  const name: string | undefined = className.match(COLOUR_CLASS)?.[1];
  const colour: string | undefined = name ? TAILWIND_COLOURS[name] : undefined;

  if (!colour) {
    throw new Error(
      `"${className}" is not a text or ground colour TailwindContrast knows.`,
    );
  }

  return colour;
};

type ChannelsFunction = (hex: string) => Array<number>;

const channels: ChannelsFunction = (hex: string): Array<number> => {
  return [1, 3, 5].map((start: number): number => {
    return parseInt(hex.slice(start, start + 2), 16);
  });
};

export type RelativeLuminanceFunction = (hex: string) => number;

/** 0 for black, 1 for white. */
export const relativeLuminance: RelativeLuminanceFunction = (
  hex: string,
): number => {
  const linear: Array<number> = channels(hex).map((part: number): number => {
    const value: number = part / 255;

    return value <= 0.03928
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  });

  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
};

export type ContrastRatioFunction = (
  foregroundHex: string,
  backgroundHex: string,
) => number;

/** From 1 (the same colour) to 21 (black on white). */
export const contrastRatio: ContrastRatioFunction = (
  foregroundHex: string,
  backgroundHex: string,
): number => {
  const lighter: number = Math.max(
    relativeLuminance(foregroundHex),
    relativeLuminance(backgroundHex),
  );
  const darker: number = Math.min(
    relativeLuminance(foregroundHex),
    relativeLuminance(backgroundHex),
  );

  return (lighter + 0.05) / (darker + 0.05);
};

export type ContrastOfClassesFunction = (
  textClass: string,
  groundClass: string,
) => number;

/** How "text-gray-500" reads on "bg-white". */
export const contrastOfClasses: ContrastOfClassesFunction = (
  textClass: string,
  groundClass: string,
): number => {
  return contrastRatio(colourOfClass(textClass), colourOfClass(groundClass));
};

type ColourClassesFunction = (
  element: Element,
  prefix: "text" | "bg",
) => Array<string>;

/*
 * A class that sets a colour: a named one or a shade, with or without an
 * opacity. `text-xs`, `text-center` and `text-[11px]` are not; a variant's
 * (`hover:text-gray-700`) never starts with the prefix.
 */
const LOOKS_LIKE_A_COLOUR: RegExp =
  /^(?:text|bg)-(white|black|[a-z]+-\d{2,3})(\/\d+)?$/;

/*
 * The element's own colour classes of one kind; a variant's are not its own.
 * One it cannot read - a shade that is not listed, a see-through colour - is
 * an error here too: passing it over would read the words as the colour of
 * whatever is above them.
 */
const colourClasses: ColourClassesFunction = (
  element: Element,
  prefix: "text" | "bg",
): Array<string> => {
  return Array.from(element.classList).filter((token: string): boolean => {
    const match: RegExpMatchArray | null = token.match(LOOKS_LIKE_A_COLOUR);

    if (!token.startsWith(`${prefix}-`) || !match) {
      return false;
    }

    if (match[2]) {
      throw new Error(
        `"${token}" is see-through, and TailwindContrast does not mix colours.`,
      );
    }

    // Refused when the shade is not listed.
    colourOfClass(token);

    return true;
  });
};

export type TextClassOfFunction = (
  element: Element,
  pageTextClass?: string,
) => string;

/**
 * The class that colours an element's words: its own, or the nearest one
 * above it. Two on one element is a mistake - which wins is the stylesheet's
 * order, not the class list's - and is refused.
 *
 * A test that draws one part of a page has no page above it. It says what
 * the page writes in (`pageTextClass`), and words nothing nearer colours are
 * read as that; without it they are refused.
 */
export const textClassOf: TextClassOfFunction = (
  element: Element,
  pageTextClass?: string,
): string => {
  let current: Element | null = element;

  while (current) {
    const own: Array<string> = colourClasses(current, "text");

    if (own.length > 1) {
      throw new Error(
        `An element has more than one text colour: ${own.join(", ")}.`,
      );
    }

    if (own.length === 1) {
      return own[0]!;
    }

    current = current.parentElement;
  }

  if (pageTextClass) {
    // Checked as any other class is: a page colour that is not known is an error.
    colourOfClass(pageTextClass);

    return pageTextClass;
  }

  throw new Error("Nothing gives these words a colour TailwindContrast knows.");
};

export type GroundClassOfFunction = (element: Element) => string;

/**
 * The class that colours what is behind an element: its own ground, or the
 * nearest one above it - and white, the page's, when nothing has one.
 */
export const groundClassOf: GroundClassOfFunction = (
  element: Element,
): string => {
  let current: Element | null = element;

  while (current) {
    const own: Array<string> = colourClasses(current, "bg");

    if (own.length > 1) {
      throw new Error(
        `An element has more than one ground: ${own.join(", ")}.`,
      );
    }

    if (own.length === 1) {
      return own[0]!;
    }

    current = current.parentElement;
  }

  return "bg-white";
};

export type ContrastOfFunction = (element: Element) => number;

/** How an element's words read on what is behind them, as it is classed. */
export const contrastOf: ContrastOfFunction = (element: Element): number => {
  return contrastOfClasses(textClassOf(element), groundClassOf(element));
};

export interface WrittenWords {
  words: string;
  textClass: string;
  groundClass: string;
  // To one decimal place, as it is usually quoted.
  contrast: number;
}

/*
 * Not words a sighted reader is asked to read: a screen reader's own, what
 * is drawn for the eye only (an arrow between two names), and a control or
 * a value that cannot be used, which WCAG leaves out.
 */
const NOT_READ: string =
  '.sr-only, [aria-hidden="true"], [aria-disabled="true"], :disabled';

// The Dashboard's own: what a dialog's words are in when nothing says otherwise.
export const PAGE_TEXT_CLASS: string = "text-gray-900";

export type WordsInFunction = (
  root: Element,
  pageTextClass?: string,
) => Array<WrittenWords>;

/**
 * Every piece of text under an element that a reader is asked to read, with
 * the colour it is written in and what is behind it.
 */
export const wordsIn: WordsInFunction = (
  root: Element,
  pageTextClass?: string,
): Array<WrittenWords> => {
  const found: Array<WrittenWords> = [];
  const walker: TreeWalker = root.ownerDocument.createTreeWalker(
    root,
    // NodeFilter.SHOW_TEXT
    4,
  );

  while (walker.nextNode()) {
    const element: Element | null = walker.currentNode.parentElement;
    const words: string = (walker.currentNode.textContent || "")
      .replace(/\s+/g, " ")
      .trim();

    if (!words || !element || element.closest(NOT_READ)) {
      continue;
    }

    const textClass: string = textClassOf(element, pageTextClass);
    const groundClass: string = groundClassOf(element);

    found.push({
      words: words,
      textClass: textClass,
      groundClass: groundClass,
      contrast: Math.round(contrastOfClasses(textClass, groundClass) * 10) / 10,
    });
  }

  return found;
};

export type UnreadableWordsFunction = (
  root: Element,
  pageTextClass?: string,
) => Array<WrittenWords>;

/** The words under an element that read at less than AA asks of small text. */
export const unreadableWords: UnreadableWordsFunction = (
  root: Element,
  pageTextClass?: string,
): Array<WrittenWords> => {
  return wordsIn(root, pageTextClass).filter(
    (written: WrittenWords): boolean => {
      return (
        contrastOfClasses(written.textClass, written.groundClass) <
        AA_TEXT_CONTRAST
      );
    },
  );
};
