import { translationKey, Translator } from "../../Types/Translator";

/*
 * THE SCREENSHOTS A PROBE TAKES WHEN A SYNTHETIC SCRIPT RUNS OUT OF TIME.
 *
 * A script that hits the probe's time limit is stopped where it stands. It
 * never reaches the screenshot it would have taken next, and a script that
 * keeps its screenshots in an object of its own and returns them - the
 * legacy pattern - loses every one it took. All such a run reported was
 * "Synthetic monitor script timed out after 180000 ms.", which says nothing
 * about where the script stopped: a sign-in that no longer finishes, a page
 * that never shows what the script waits for and a site that never answers
 * all read the same.
 *
 * So when the time runs out, the probe takes a screenshot of every page the
 * script still has open before it stops the run, and stores each under a
 * name written here: the first open page as "timed-out-page", the others,
 * in the order they were opened, as "timed-out-page-2", "timed-out-page-3"
 * and so on. The names are stored as a script's own screenshot names are,
 * and written the way the docs name a script's screenshots, so an
 * incident's description can show one as it shows any other:
 * {{syntheticResponses[0].screenshots.timed-out-page}}.
 *
 * A monitor's summary draws the name as words, in the reader's language
 * (getSyntheticScreenshotCaption): "Page when the script timed out", "Page
 * 2 when the script timed out". A screenshot the script named itself keeps
 * its name as written.
 *
 * The words are translation keys: the Dashboard's npm run i18n:extract
 * reads this directory.
 */

// The first page the script had open when it ran out of time.
export const TIMED_OUT_PAGE_SCREENSHOT_NAME: string = "timed-out-page";

// The other pages are numbered from 2, after the first page's name.
const NUMBERED_NAME_PREFIX: string = `${TIMED_OUT_PAGE_SCREENSHOT_NAME}-`;

export const TIMED_OUT_PAGE_SCREENSHOT_CAPTION: string = translationKey(
  "Page when the script timed out",
);

export const TIMED_OUT_NUMBERED_PAGE_SCREENSHOT_CAPTION: string =
  translationKey("Page {{number}} when the script timed out");

/*
 * A page number the probe writes for a page after the first: Latin digits
 * as String(number) writes a whole number from 2 up, with no leading zero,
 * and no longer than a run could open pages. Anchored, so it reads any
 * name in time that grows with its length.
 */
const STORED_PAGE_NUMBER_PATTERN: RegExp = /^[2-9]$|^[1-9][0-9]{1,3}$/;

/*
 * The name the probe stores the screenshot of the `pageNumber`th page the
 * script had open under, counted from 1 in the order the pages were opened.
 */
export const getTimedOutPageScreenshotName: (pageNumber: number) => string = (
  pageNumber: number,
): string => {
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) {
    throw new Error(
      `A timed-out page's number must be a whole number from 1, not ${pageNumber}.`,
    );
  }

  return pageNumber === 1
    ? TIMED_OUT_PAGE_SCREENSHOT_NAME
    : `${NUMBERED_NAME_PREFIX}${pageNumber}`;
};

/*
 * The number of the page a stored screenshot name is the probe's
 * screenshot of, when the name is exactly one the probe writes
 * (getTimedOutPageScreenshotName); null for any other name - the script's
 * own, or one close to the probe's but not the same ("timed-out-page-1",
 * "timed-out-page (2)", "Timed-Out-Page") - which stays as written.
 */
export const readTimedOutPageScreenshotName: (
  name: string | null | undefined,
) => number | null = (name: string | null | undefined): number | null => {
  if (typeof name !== "string") {
    return null;
  }

  if (name === TIMED_OUT_PAGE_SCREENSHOT_NAME) {
    return 1;
  }

  if (!name.startsWith(NUMBERED_NAME_PREFIX)) {
    return null;
  }

  const pageNumber: string = name.slice(NUMBERED_NAME_PREFIX.length);

  if (!STORED_PAGE_NUMBER_PATTERN.test(pageNumber)) {
    return null;
  }

  return Number.parseInt(pageNumber, 10);
};

/*
 * A screenshot's name as a monitor's summary draws it under the
 * screenshot: the probe's screenshot of a timed-out page in the reader's
 * words, with the page's number in the reader's digits; any other name -
 * the one the script gave its screenshot - as written.
 */
export const getSyntheticScreenshotCaption: (data: {
  translator: Translator;
  screenshotName: string;
}) => string = (data: {
  translator: Translator;
  screenshotName: string;
}): string => {
  const pageNumber: number | null = readTimedOutPageScreenshotName(
    data.screenshotName,
  );

  if (pageNumber === null) {
    return data.screenshotName;
  }

  if (pageNumber === 1) {
    return (
      data.translator.translateText(TIMED_OUT_PAGE_SCREENSHOT_CAPTION) ||
      TIMED_OUT_PAGE_SCREENSHOT_CAPTION
    );
  }

  return data.translator.translateTemplate(
    TIMED_OUT_NUMBERED_PAGE_SCREENSHOT_CAPTION,
    {
      number: data.translator.formatNumber(pageNumber),
    },
  );
};
