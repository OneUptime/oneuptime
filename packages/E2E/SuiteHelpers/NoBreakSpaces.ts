/*
 * The spaces OneUptime draws where a line may not break, for a spec to
 * expect as the product writes them.
 *
 * A number and its unit are one quantity: the product joins them with a
 * no-break space (U+00A0), in English too, so "182 ms" never ends a line
 * with "182" and starts the next with "ms" (Docs/ux/README.md › Numbers,
 * dates and plurals, "A number keeps its unit on its line";
 * Common/Types/NoBreakSpaces; #8302). A spec that reads a value as a raw
 * string - textContent, innerText, a list of facts - and compares it with
 * "182 ms" typed with a plain space fails on the one code point it cannot
 * see (#8689). Writing the space as typed text hides it from a reader of
 * the spec, so a spec writes the quantity with `withUnit` instead, and the
 * test fails if the unit can break from its number again.
 *
 * Playwright's toHaveText and toContainText, given a string, fold every
 * run of white space - U+00A0 among it - into one plain space, so they
 * pass either way and pin nothing about the space: compare a read string
 * with toBe, toEqual or startsWith to hold the space to U+00A0.
 */

// The space no line breaks at, as the product writes it between a number and its unit.
export const NO_BREAK_SPACE: string = "\u00A0";

// What a failure message draws for a no-break space: a space and U+00A0 look the same.
export const NO_BREAK_SPACE_SHOWN_AS: string = "⍽";

export type WithUnitFunction = (
  figure: string | number,
  unit: string,
) => string;

/*
 * A figure and its unit as the product draws them: "182 ms" is
 * withUnit(182, "ms"), "2,410 ms" withUnit("2,410", "ms"). The figure is
 * written as given - a number in its String() form, a string as it is,
 * already in the reader's digits and separators - and joined to the unit
 * by a no-break space. A figure or a unit that is empty, starts or ends
 * with a space, or holds a plain one, is a mistake in the spec ("182 ms"
 * passed as the figure), and throws; a no-break space of the figure's own
 * - French's thousands, "1\u202F234" - is kept.
 */
export const withUnit: WithUnitFunction = (
  figure: string | number,
  unit: string,
): string => {
  const written: string = typeof figure === "number" ? String(figure) : figure;

  if (typeof figure === "number" && !Number.isFinite(figure)) {
    throw new Error(
      `withUnit: ${written} is no figure to write beside "${unit}".`,
    );
  }

  for (const [name, part] of [
    ["figure", written],
    ["unit", unit],
  ] as Array<[string, string]>) {
    if (part.length === 0) {
      throw new Error(`withUnit: the ${name} is empty.`);
    }

    if (part.trim() !== part || part.includes(" ")) {
      throw new Error(
        `withUnit: the ${name} ${JSON.stringify(part)} holds a space; write the figure and the unit apart.`,
      );
    }
  }

  return `${written}${NO_BREAK_SPACE}${unit}`;
};

export type WithSpacesShownFunction = (text: string) => string;

/*
 * `text` with each no-break space drawn as "⍽", for an expectation whose
 * failure should say which space it read: expect(withSpacesShown(read))
 * .toBe(withSpacesShown(expected)) reads "Up · 182⍽ms" beside "Up · 182 ms"
 * where a plain toBe printed two strings that looked alike. A text that
 * already holds "⍽" cannot be told apart from its spaces, and throws.
 */
export const withSpacesShown: WithSpacesShownFunction = (
  text: string,
): string => {
  if (text.includes(NO_BREAK_SPACE_SHOWN_AS)) {
    throw new Error(
      `withSpacesShown: "${text}" already holds "${NO_BREAK_SPACE_SHOWN_AS}", which it draws a no-break space as.`,
    );
  }

  return text.split(NO_BREAK_SPACE).join(NO_BREAK_SPACE_SHOWN_AS);
};
