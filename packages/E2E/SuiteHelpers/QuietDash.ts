import { expect, Locator } from "@playwright/test";

/*
 * What an element draws, and what a screen reader reads of it, apart.
 *
 * A figure with no reading is drawn as the quiet dash, EmptyFigure
 * (Common/UI/Components/EmptyFigure, #8647): "—" on screen, hidden from a
 * screen reader (aria-hidden), and "Not set" - or the tile's own words -
 * for a screen reader only (sr-only). An element's textContent holds both,
 * "—Not set", which nobody sees or hears: Monitor Overview, Cloud Spend
 * and Meraki Traffic compared it with "—" and went red (#8735, #8749). A
 * spec reads the two apart, and pins both.
 */

// The words a page writes for a screen reader only.
const SCREEN_READER_ONLY: string = ".sr-only";

// What a page hides from a screen reader.
const HIDDEN_FROM_SCREEN_READERS: string = '[aria-hidden="true"]';

// EmptyFigure's own test id (EMPTY_FIGURE_TEST_ID).
export const EMPTY_FIGURE_TEST_ID: string = "empty-figure";

// The quiet dash EmptyFigure draws (EMPTY_VALUE_MARK).
export const QUIET_DASH: string = "—";

// What a screen reader hears for an EmptyFigure with no words of its own.
export const NOT_SET: string = "Not set";

// The element's text without the parts `selector` matches, trimmed.
async function textWithout(
  locator: Locator,
  selector: string,
): Promise<string> {
  return locator.evaluate((element: Element, left: string): string => {
    const copy: Element = element.cloneNode(true) as Element;
    copy.querySelectorAll(left).forEach((part: Element) => {
      part.remove();
    });
    return (copy.textContent || "").trim();
  }, selector);
}

export type DrawnTextOfFunction = (locator: Locator) => Promise<string>;

// What the element draws: its text without the words only a screen reader reads.
export const drawnTextOf: DrawnTextOfFunction = async (
  locator: Locator,
): Promise<string> => {
  return textWithout(locator, SCREEN_READER_ONLY);
};

export type HeardTextOfFunction = (locator: Locator) => Promise<string>;

// What a screen reader reads of the element: its text without what is hidden from one.
export const heardTextOf: HeardTextOfFunction = async (
  locator: Locator,
): Promise<string> => {
  return textWithout(locator, HIDDEN_FROM_SCREEN_READERS);
};

export type ExpectQuietDashFunction = (
  locator: Locator,
  heard?: string,
) => Promise<void>;

/*
 * That the element is a figure with no reading: EmptyFigure, drawn as the
 * quiet dash and heard as `heard` ("Not set" when left out). Waits for the
 * dash as toHaveText does, then reads what is heard.
 */
export const expectQuietDash: ExpectQuietDashFunction = async (
  locator: Locator,
  heard: string = NOT_SET,
): Promise<void> => {
  await expect
    .poll(
      async (): Promise<string> => {
        return drawnTextOf(locator);
      },
      { message: `${String(locator)} draws the quiet dash` },
    )
    .toBe(QUIET_DASH);
  await expect(locator.getByTestId(EMPTY_FIGURE_TEST_ID)).toHaveCount(1);
  expect(await heardTextOf(locator), `${String(locator)} is heard as`).toBe(
    heard,
  );
};
