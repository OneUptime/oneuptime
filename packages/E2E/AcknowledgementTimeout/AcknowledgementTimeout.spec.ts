import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs";
import path from "path";

/*
 * An on-call policy's acknowledgement timeout (issue #5123): page again
 * when an acknowledged incident or alert is still not resolved after so
 * many minutes. In a browser, against the offline fixture
 * (AcknowledgementTimeout/Fixture), on the policy's Escalation Rules page.
 *
 * The maintainer's ask: "This is an advanced feature, so if you choose to
 * build it, please make sure it is hidden and it is not visible by default
 * to the user. Please make sure to reduce decision paralysis as much as
 * possible." So what is pinned here: the setting waits, folded, under More
 * settings below the cards everyone uses, named but not open; opened, it
 * is one card with one row; its dialog asks one question with two answers,
 * and the minutes only once Page again is picked, 30 to start with; a save
 * sends the one column - the minutes, or empty to turn it off; and all of
 * it fits a 390px phone, in German too, and reads in dark mode. The
 * fixture records every save, so the tests check what was sent as well as
 * what was drawn.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-0000000000d1";
const POLICY_ID: string = "20000000-0000-4000-8000-0000000000d1";
const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/on-call-duty/policies/${POLICY_ID}/escalation`;
const PORT: string =
  process.env["ACKNOWLEDGEMENT_TIMEOUT_FIXTURE_PORT"] || "4241";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/acknowledgement-timeout-ui",
);

// The Dashboard's German words, as the fixture draws them with ?lang=de.
const GERMAN: Record<string, string> = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      "../../App/FeatureSet/Dashboard/src/Locales/de.json",
    ),
    "utf8",
  ),
) as Record<string, string>;

const MORE_SETTINGS_TEST_ID: string = "on-call-policy-more-settings";
const CARD_TITLE: string = "Acknowledgement Timeout";
const CARD_DESCRIPTION: string =
  "What happens when someone acknowledges but nobody resolves.";
const DIALOG_TITLE: string = "Edit Acknowledgement Timeout";
const QUESTION: string = "If it is acknowledged but not resolved";
const OFF: string = "Don't page again";
const PAGE_AGAIN: string = "Page again";
const MINUTES_TITLE: string = "After how many minutes?";
const MINUTES_DESCRIPTION: string =
  "Counted from each acknowledgement. It pages again 5 times at most.";
const ROW_TITLE: string = "After an acknowledgement";
const MINUTES_REFUSAL: string =
  "Enter a whole number of minutes between 5 and 1440.";
const SAVE: string = "Save Changes";
const PLURAL_KEY: string =
  "Page again if not resolved within {{count}} minutes";

function pagesAgainAfter(minutes: number): string {
  return `Page again if not resolved within ${minutes} minute${
    minutes === 1 ? "" : "s"
  }`;
}

interface RecordedSave {
  model: string;
  data: Record<string, unknown>;
}

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });

  // Nothing may leave the fixture: a request to a real host is a test bug.
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());

    if (target.hostname === "127.0.0.1" && target.port === PORT) {
      await route.continue();
      return;
    }

    await route.abort();
  });
});

test.afterEach(({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || []).toEqual([]);
});

/*
 * The whole page - or, with a dialog open, the screen: a dialog's backdrop
 * covers the screen only, so a whole-page shot would show half the page
 * dimmed.
 */
async function screenshot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    fullPage: (await dialog(page).count()) === 0,
    animations: "disabled",
  });
}

async function openPage(page: Page, query: string = ""): Promise<void> {
  await page.goto(`${PAGE_PATH}${query}`);
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
  await expect(moreSettings(page)).toBeVisible();
  // The cards everyone uses have loaded: the level, and the repeat card.
  await expect(page.getByText("Level 1").first()).toBeVisible();
}

function moreSettings(page: Page): Locator {
  return page.getByTestId(MORE_SETTINGS_TEST_ID);
}

function foldHeader(page: Page): Locator {
  return moreSettings(page).getByTestId("folded-section-header");
}

function foldedItems(page: Page): Locator {
  return moreSettings(page).getByTestId("folded-section-item");
}

function dialog(page: Page): Locator {
  return page.getByRole("dialog");
}

function minutesBox(page: Page): Locator {
  return dialog(page).getByRole("spinbutton");
}

function summary(page: Page): Locator {
  return moreSettings(page).getByTestId("acknowledgement-timeout-summary");
}

/*
 * The last line of the Escalation summary at the top of the page, while
 * the policy pages again: the setting is folded away, the summary is read
 * first.
 */
function summaryLine(page: Page): Locator {
  return page.getByTestId("escalation-summary-page-again");
}

function summarySentence(duration: string): string {
  return `If it is acknowledged but not resolved within ${duration}, it pages again, up to 5 times.`;
}

/*
 * Opens More settings, and waits for the card's row to show. (Not its
 * description: a card hides its description below the md breakpoint.)
 */
async function openFold(page: Page): Promise<void> {
  await foldHeader(page).click();
  await expect(foldHeader(page)).toHaveAttribute("aria-expanded", "true");
  await expect(summary(page)).toBeVisible();
}

async function openDialog(page: Page): Promise<void> {
  await moreSettings(page).getByRole("button", { name: "Edit" }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByText(DIALOG_TITLE)).toBeVisible();
}

async function saves(page: Page): Promise<Array<RecordedSave>> {
  return page.evaluate((): Array<RecordedSave> => {
    return (window as unknown as { __fixture: { saves: Array<RecordedSave> } })
      .__fixture.saves;
  });
}

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const widths: { scroll: number; view: number } = await page.evaluate(
    (): { scroll: number; view: number } => {
      return {
        scroll: document.documentElement.scrollWidth,
        view: window.innerWidth,
      };
    },
  );

  expect(widths.scroll).toBeLessThanOrEqual(widths.view);
}

test("keeps the setting folded under More settings, below the cards everyone uses, naming it", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page);

  await expect(foldHeader(page)).toHaveAttribute("aria-expanded", "false");
  await expect(foldHeader(page)).toContainText("More settings");
  // Folded, it names the card it holds - and nothing set, so no value.
  await expect(foldedItems(page)).toHaveCount(1);
  await expect(foldedItems(page)).toHaveText(CARD_TITLE);
  await expect(
    moreSettings(page).getByText(CARD_DESCRIPTION, { exact: true }),
  ).toBeHidden();
  await expect(
    moreSettings(page).getByRole("button", { name: "Edit" }),
  ).toBeHidden();

  // The Repeat Policy card the page always showed comes first, then the fold.
  const repeat: Locator = page.getByText("Repeat Policy", { exact: true });
  await expect(repeat).toBeVisible();
  const repeatBox: { y: number } | null = await repeat.boundingBox();
  const foldBox: { y: number } | null = await moreSettings(page).boundingBox();
  expect(repeatBox).not.toBeNull();
  expect(foldBox).not.toBeNull();
  expect(foldBox!.y).toBeGreaterThan(repeatBox!.y);

  // A policy that does not page again: its summary reads as it always did.
  await expect(
    page.getByText(
      "If no one acknowledges after the final level, escalation stops here.",
    ),
  ).toBeVisible();
  await expect(summaryLine(page)).toHaveCount(0);

  await expectNoSidewaysScroll(page);
  await screenshot(page, "folded-1280");
});

test("opens on a click: one card, one row, saying the policy does not page again", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page);
  await openFold(page);

  await expect(
    moreSettings(page).getByText(CARD_TITLE, { exact: true }),
  ).toBeVisible();
  await expect(
    moreSettings(page).getByText(CARD_DESCRIPTION, { exact: true }),
  ).toBeVisible();
  await expect(
    moreSettings(page).getByText(ROW_TITLE, { exact: true }),
  ).toBeVisible();
  await expect(summary(page)).toHaveText(OFF);
  // Open, the fold no longer lists what it holds: the card says it.
  await expect(foldedItems(page)).toHaveCount(0);

  /*
   * With nothing under it - no names once open, no description of its own -
   * the header's title sits level with the icon tile beside it, not at the
   * tile's top edge where a line under it would start.
   *
   * Both read from one layout: opening the fold scrolls it into view
   * smoothly (BringIntoView), so two reads one after the other can each
   * catch a different point of that scroll, and differ by it.
   */
  const [titleMiddle, iconMiddle]: Array<number> = await foldHeader(
    page,
  ).evaluate((header: Element): Array<number> => {
    return ["folded-section-title", "folded-section-icon"].map(
      (testId: string): number => {
        const element: Element | null = header.querySelector(
          `[data-testid="${testId}"]`,
        );

        if (!element) {
          return Number.NaN;
        }

        const box: DOMRect = element.getBoundingClientRect();

        return box.top + box.height / 2;
      },
    );
  });

  expect(Math.abs(titleMiddle! - iconMiddle!)).toBeLessThanOrEqual(2);

  await screenshot(page, "open-1280");
});

test("pages again in one dialog: Page again, 30 minutes to start with, sent as the one column", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page);
  await openFold(page);
  await openDialog(page);

  // One question, two answers, and the minutes only once it pages again.
  await expect(dialog(page).getByText(QUESTION)).toBeVisible();
  await expect(dialog(page).getByRole("radio")).toHaveCount(2);
  await expect(
    dialog(page).getByRole("radio", { name: OFF, exact: true }),
  ).toBeChecked();
  await expect(minutesBox(page)).toHaveCount(0);
  await screenshot(page, "dialog-off-1280");

  await dialog(page).getByText(PAGE_AGAIN, { exact: true }).click();
  await expect(
    dialog(page).getByRole("radio", { name: PAGE_AGAIN, exact: true }),
  ).toBeChecked();
  await expect(minutesBox(page)).toBeVisible();
  await expect(minutesBox(page)).toHaveValue("30");
  await expect(dialog(page).getByText(MINUTES_TITLE)).toBeVisible();
  await expect(dialog(page).getByText(MINUTES_DESCRIPTION)).toBeVisible();
  await screenshot(page, "dialog-page-again-1280");

  await dialog(page).getByRole("button", { name: SAVE }).click();
  await expect(dialog(page)).toHaveCount(0);

  const sent: Array<RecordedSave> = await saves(page);
  expect(sent).toHaveLength(1);
  expect(sent[0]!.model).toBe("OnCallDutyPolicy");
  expect(sent[0]!.data["acknowledgementTimeoutInMinutes"]).toBe(30);
  // The choice is the form's own: it is never sent.
  expect(Object.keys(sent[0]!.data)).not.toContain(
    "acknowledgementTimeoutChoice",
  );

  await expect(summary(page)).toHaveText(pagesAgainAfter(30));
  // The Escalation summary at the top says so at once, with no reload.
  await expect(summaryLine(page)).toHaveText(summarySentence("30 min"));

  // Folded again, More settings says what it is set to.
  await foldHeader(page).click();
  await expect(foldHeader(page)).toHaveAttribute("aria-expanded", "false");
  await expect(foldedItems(page)).toHaveCount(1);
  await expect(foldedItems(page)).toContainText(CARD_TITLE);
  await expect(foldedItems(page)).toContainText("30 min");
  await expect(summaryLine(page)).toBeVisible();
});

test("takes the minutes typed, from 5 to 1440, and refuses the rest before anything is sent", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page);
  await openFold(page);
  await openDialog(page);
  await dialog(page).getByText(PAGE_AGAIN, { exact: true }).click();

  /*
   * One sentence for every value the box may not hold - too few, too many,
   * a fraction (which only the server refused before), nothing - that says
   * what to type, rather than the form's words around the question
   * ("After how many minutes? should not be less than 5.").
   */
  for (const typed of ["4", "1441", "7.5", ""]) {
    await minutesBox(page).fill(typed);
    await dialog(page).getByRole("button", { name: SAVE }).click();
    await expect(dialog(page)).toContainText(MINUTES_REFUSAL);
    await expect(dialog(page)).not.toContainText("should not be");
    await expect(dialog(page)).not.toContainText("is required");
    // Typing kept Page again picked, and the box where it was.
    await expect(
      dialog(page).getByRole("radio", { name: PAGE_AGAIN, exact: true }),
    ).toBeChecked();
    expect(await saves(page)).toHaveLength(0);
  }

  await minutesBox(page).fill("45");
  await dialog(page).getByRole("button", { name: SAVE }).click();
  await expect(dialog(page)).toHaveCount(0);

  const sent: Array<RecordedSave> = await saves(page);
  expect(sent).toHaveLength(1);
  expect(sent[0]!.data["acknowledgementTimeoutInMinutes"]).toBe(45);
  await expect(summary(page)).toHaveText(pagesAgainAfter(45));
});

test("turns it off again: Don't page again sends an empty timeout", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page, "?timeout=45");

  // Folded, the set card says what it is set to.
  await expect(foldedItems(page)).toContainText(CARD_TITLE);
  await expect(foldedItems(page)).toContainText("45 min");
  // And the Escalation summary at the top says it in words.
  await expect(summaryLine(page)).toHaveText(summarySentence("45 min"));

  await openFold(page);
  await expect(summary(page)).toHaveText(pagesAgainAfter(45));

  await openDialog(page);
  await expect(
    dialog(page).getByRole("radio", { name: PAGE_AGAIN, exact: true }),
  ).toBeChecked();
  await expect(minutesBox(page)).toHaveValue("45");

  await dialog(page).getByText(OFF, { exact: true }).click();
  await expect(minutesBox(page)).toHaveCount(0);
  await dialog(page).getByRole("button", { name: SAVE }).click();
  await expect(dialog(page)).toHaveCount(0);

  const sent: Array<RecordedSave> = await saves(page);
  expect(sent).toHaveLength(1);
  expect(sent[0]!.data).toHaveProperty("acknowledgementTimeoutInMinutes", null);

  await expect(summary(page)).toHaveText(OFF);
  // Off: the summary's line goes at once.
  await expect(summaryLine(page)).toHaveCount(0);

  await foldHeader(page).click();
  await expect(foldedItems(page)).toHaveText(CARD_TITLE);
});

test("a save the server refuses says why and keeps the dialog, and the next one goes through", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page, "?fail=save");
  await openFold(page);
  await openDialog(page);
  await dialog(page).getByText(PAGE_AGAIN, { exact: true }).click();
  await dialog(page).getByRole("button", { name: SAVE }).click();

  await expect(dialog(page)).toContainText(
    "The policy could not be saved. Please try again.",
  );
  await expect(minutesBox(page)).toHaveValue("30");

  await dialog(page).getByRole("button", { name: SAVE }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(await saves(page)).toHaveLength(2);
  await expect(summary(page)).toHaveText(pagesAgainAfter(30));
});

test("reads in dark mode", async ({ page }: { page: Page }) => {
  await openPage(page, "?timeout=30&theme=dark");
  await openFold(page);

  await expect(summary(page)).toHaveText(pagesAgainAfter(30));
  await screenshot(page, "open-dark-1280");
});

test.describe("on a 390px phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("fits folded, open and in the dialog, with nothing to scroll sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, "?timeout=30");
    await expect(foldedItems(page)).toContainText("30 min");
    await expectNoSidewaysScroll(page);
    await screenshot(page, "folded-390");

    await openFold(page);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "open-390");

    await openDialog(page);
    const box: { x: number; width: number } | null =
      await dialog(page).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await expect(minutesBox(page)).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "dialog-390");
  });

  test("in German too, in the Dashboard's own German words", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, "?timeout=30&lang=de");

    await expect(foldedItems(page)).toContainText(GERMAN[CARD_TITLE]!);
    await openFold(page);
    await expect(
      moreSettings(page).getByText(GERMAN[ROW_TITLE]!, { exact: true }),
    ).toBeVisible();
    await expect(summary(page)).toHaveText(
      GERMAN[PLURAL_KEY]!.replace("{{count}}", "30"),
    );
    await expectNoSidewaysScroll(page);

    await moreSettings(page)
      .getByRole("button", { name: GERMAN["Edit"]! })
      .click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByText(GERMAN[DIALOG_TITLE]!)).toBeVisible();
    await expect(
      dialog(page).getByRole("radio", { name: GERMAN[OFF]!, exact: true }),
    ).toBeVisible();
    await expect(
      dialog(page).getByRole("radio", {
        name: GERMAN[PAGE_AGAIN]!,
        exact: true,
      }),
    ).toBeChecked();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "dialog-de-390");
  });
});
