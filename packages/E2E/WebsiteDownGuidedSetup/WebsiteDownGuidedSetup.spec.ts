import { expect, Locator, Page, Route, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * THE GUIDED WEBSITE SETUP, LOOKED AT (#7056): "Know when my website or API
 * is down" in the real Dashboard, over the journeys' fixture
 * (Journeys/Fixture, Journeys/README.md): a project made a minute ago, kept
 * in memory, with nothing leaving the machine.
 *
 * jsdom (Common/Tests/App/Dashboard/WebsiteDownGuidedSetup.test.tsx) holds
 * what each step does; the journey website-down-guided counts what the job
 * costs. Neither looks at the page. Here each step and the summary are
 * walked and drawn at 1280 and 390 pixels, light and dark, in German and in
 * Persian (right to left): no step reaches past the window, and each is
 * kept as a picture under output/playwright/website-down-guided-setup-ui.
 * On the way, what the steps gained is used as a person uses it: how many
 * locations check the address (#7461), the How to Reach Me link (#7757),
 * the test page dialog's line under Severity (#7756), the step that shows
 * the monitor on a status page (#7053) and the summary's way to paging by
 * phone (#7370). Besides, the paths the guide's "What can go wrong" names:
 * a run left and opened again, a test page nobody acknowledged ("I did not
 * get it"), a server that cannot send email yet, and a teammate's monitor
 * already checking the address (#7254).
 */

const PORT: string =
  process.env["WEBSITE_DOWN_GUIDED_SETUP_FIXTURE_PORT"] || "4853";
const ORIGIN: string = `http://127.0.0.1:${PORT}`;
const PROJECT: string = "10000000-0000-4000-8000-000000006831";
const SETUP: string = `/dashboard/${PROJECT}/monitors/setup`;
const HOME: string = `/dashboard/${PROJECT}/home/`;
const NOW: Date = new Date("2026-11-11T10:00:00.000Z");
// Where the Dashboard keeps the reader's language (DashboardLanguage.ts).
const LANGUAGE_KEY: string = "oneuptimeLang";
const ADDRESS: string = "https://acme-commerce.example";
// ?seed=teammate-monitor's monitor, which Ada made (Journeys/Fixture/NewProject.js).
const TEAMMATE_MONITOR_ID: string = "50000000-0000-4000-8000-000000000003";
// ?seed=status-page's page.
const STATUS_PAGE_NAME: string = "Acme status";
const SHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/website-down-guided-setup-ui",
);
const LOCALES: string = path.resolve(
  __dirname,
  "../../App/FeatureSet/Dashboard/src/Locales",
);

type Language = "de" | "fa";
type Theme = "light" | "dark";

interface Look {
  lang: Language;
  theme: Theme;
  width: number;
}

// A write the fixture's server kept (Journeys/Fixture/Store.js).
interface FixtureWrite {
  kind: "create" | "update" | "delete";
  table: string;
  data: Record<string, unknown>;
}

const tables: Map<Language, Record<string, string>> = new Map();

// The Dashboard's English words as this language draws them.
function words(lang: Language, english: string): string {
  let table: Record<string, string> | undefined = tables.get(lang);

  if (!table) {
    table = JSON.parse(
      fs.readFileSync(path.join(LOCALES, `${lang}.json`), "utf8"),
    ) as Record<string, string>;
    tables.set(lang, table);
  }

  return table[english] || english;
}

const pageErrors: Array<string> = [];
const leftTheMachine: Array<string> = [];

test.beforeEach(async ({ page }: { page: Page }) => {
  pageErrors.length = 0;
  leftTheMachine.length = 0;
  page.on("pageerror", (error: Error) => {
    pageErrors.push(error.message);
  });
  await page.route(
    (url: URL) => {
      return url.origin !== ORIGIN;
    },
    async (route: Route) => {
      leftTheMachine.push(route.request().url());
      await route.abort();
    },
  );
  await page.clock.setFixedTime(NOW);
});

test.afterEach(() => {
  expect(pageErrors, "the product threw").toEqual([]);
  expect(leftTheMachine, "a request left this machine").toEqual([]);
});

function nameOf(look: Look): string {
  return `${look.lang}-${look.theme}-${look.width}`;
}

// The setup, in this look, for the fixture's query (who, seeds, the server).
async function open(
  page: Page,
  look: Look,
  query: Record<string, string> = {},
): Promise<void> {
  await page.setViewportSize({ width: look.width, height: 900 });
  await page.addInitScript(
    ({ key, value }: { key: string; value: string }) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // A page that cannot keep it draws English, and the checks say so.
      }
    },
    { key: LANGUAGE_KEY, value: look.lang },
  );
  const search: URLSearchParams = new URLSearchParams({
    ...query,
    theme: look.theme,
  });

  await page.goto(`${ORIGIN}${SETUP}?${search.toString()}`);
  await expect(page.getByTestId("guided-setup")).toBeVisible();

  // The look asked for, not one the page fell back to.
  const html: Locator = page.locator("html");

  if (look.theme === "dark") {
    await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
  } else {
    await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
  }

  await expect(html).toHaveAttribute("dir", look.lang === "fa" ? "rtl" : "ltr");
}

function step(page: Page, key: string): Locator {
  return page.getByTestId(`guided-setup-step-${key}`);
}

/*
 * The page as it is now: nothing reaches past the window, and a picture of
 * the whole page, named for the look and the moment. It is taken from the
 * top, so the sticky header is drawn where it belongs and not over the step
 * the page had scrolled to; and a button that just changed its words and
 * style (Start checking giving way to Create my own monitor) is drawn as it
 * ends up, not halfway through its colour change.
 */
async function look(page: Page, look: Look, moment: string): Promise<void> {
  await expectNoSidewaysScroll(page, {
    message: `${nameOf(look)}, ${moment}`,
  });
  await page.evaluate(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  });
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SHOTS, `${nameOf(look)}-${moment}.png`),
    fullPage: true,
    animations: "disabled",
  });
}

// A button by its words in this language, inside `within`.
function button(
  within: Page | Locator,
  lang: Language,
  english: string,
): Locator {
  return within.getByRole("button", { name: words(lang, english) });
}

async function writesTo(
  page: Page,
  table: string,
): Promise<Array<FixtureWrite>> {
  const writes: Array<FixtureWrite> = await page.evaluate(() => {
    return (
      window as unknown as { __journeyFixture: { writes: Array<FixtureWrite> } }
    ).__journeyFixture.writes;
  });

  return writes.filter((write: FixtureWrite) => {
    return write.table === table;
  });
}

/*
 * The first check's answer, in: what the probes found, and Continue. Both
 * probes answer at once (Journeys/Fixture/NewProject.js).
 */
async function expectTheFirstCheck(page: Page): Promise<void> {
  await expect(page.getByTestId("guided-setup-first-check")).not.toBeEmpty();
  await expect(page.getByTestId("guided-setup-check-continue")).toBeVisible();
}

// Step 1, typed and checked.
async function checkTheAddress(page: Page): Promise<void> {
  await page.getByTestId("guided-setup-address").fill(ADDRESS);
  await page.getByTestId("guided-setup-start-checking").click();
  await expectTheFirstCheck(page);
}

// Steps 1 and 2 as a newcomer walks them, to the test.
async function walkToTheTest(page: Page): Promise<void> {
  await checkTheAddress(page);
  await page.getByTestId("guided-setup-check-continue").click();
  await expect(step(page, "who_is_told")).toHaveAttribute("data-state", "open");
  await page.getByTestId("guided-setup-who-continue").click();
  await expect(step(page, "test")).toHaveAttribute("data-state", "open");
}

const LOOKS: Array<Look> = [];

for (const lang of ["de", "fa"] as Array<Language>) {
  for (const theme of ["light", "dark"] as Array<Theme>) {
    for (const width of [1280, 390]) {
      LOOKS.push({ lang, theme, width });
    }
  }
}

for (const each of LOOKS) {
  test(`${nameOf(each)}: every step and the summary fit the window`, async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(240000);
    // A project with a status page, so the run walks step 4 (#7053).
    await open(page, each, { seed: "status-page" });

    // 1. What should we check? From how many locations, before anything is made (#7461).
    await expect(step(page, "check")).toHaveAttribute("data-state", "open");
    await expect(page.getByTestId("guided-setup-check-help")).toBeVisible();
    await look(page, each, "1-check");
    await checkTheAddress(page);
    await look(page, each, "1-check-answered");
    await page.getByTestId("guided-setup-check-continue").click();

    // 2. Who should be told? How to Reach Me opens in a tab of its own (#7757).
    await expect(step(page, "who_is_told")).toHaveAttribute(
      "data-state",
      "open",
    );
    await expect(
      page.getByTestId("guided-setup-how-to-reach-me"),
    ).toHaveAttribute("target", "_blank");
    await look(page, each, "2-who");
    await page.getByTestId("guided-setup-who-continue").click();

    // 3. Send a test: the dialog says what Severity changes (#7756).
    await expect(step(page, "test")).toHaveAttribute("data-state", "open");
    await look(page, each, "3-test");
    await step(page, "test").getByTestId("send-test-page").click();

    const dialog: Locator = page.getByRole("dialog");

    await expect(dialog.getByTestId("test-page-severity-hint")).toBeVisible();
    await look(page, each, "3-test-dialog");
    await button(dialog, each.lang, "Send test page").click();
    // Acknowledged from the email at once: the dialog gives way to the result.
    await expect(page.getByTestId("guided-setup-test-continue")).toBeVisible();
    await look(page, each, "3-test-acknowledged");
    await page.getByTestId("guided-setup-test-continue").click();

    // 4. Show it to customers? The project's page is picked already.
    await expect(step(page, "status_page")).toHaveAttribute(
      "data-state",
      "open",
    );
    await expect(step(page, "status_page")).toContainText(STATUS_PAGE_NAME);
    await look(page, each, "4-status-page");
    await page.getByTestId("guided-setup-status-page-add").click();

    // The summary: the page that shows it, and the way to paging by phone (#7370).
    const summary: Locator = page.getByTestId("guided-setup-summary");

    await expect(summary).toBeVisible();
    await expect(
      page.getByTestId("guided-setup-summary-status_page"),
    ).toContainText(STATUS_PAGE_NAME);
    await expect(
      page.getByTestId("guided-setup-next-open-status-page"),
    ).toHaveAttribute("target", "_blank");
    await expect(page.getByTestId("guided-setup-next-phone")).toBeVisible();
    await look(page, each, "5-summary");

    // What the fixture's server kept: the monitor, on the page picked.
    expect(await writesTo(page, "StatusPageResource")).toHaveLength(1);
  });
}

/*
 * A run left on its test and opened again, as a person who went to Home
 * and came back: the steps done stay done, and the setup opens on the one
 * it was on. Nothing is made twice.
 */
for (const width of [1280, 390]) {
  test(`a run left and opened again, ${width}px: back on its test, in German`, async ({
    page,
  }: {
    page: Page;
  }) => {
    const each: Look = { lang: "de", theme: "light", width };

    await open(page, each);
    await walkToTheTest(page);

    await page.goto(`${ORIGIN}${HOME}`);
    await expect(page.getByTestId("guided-setup")).toHaveCount(0);
    await page.goto(`${ORIGIN}${SETUP}`);
    await expect(page.getByTestId("guided-setup")).toBeVisible();

    await expect(step(page, "check")).toHaveAttribute("data-state", "done");
    await expect(step(page, "who_is_told")).toHaveAttribute(
      "data-state",
      "done",
    );
    await expect(step(page, "test")).toHaveAttribute("data-state", "open");
    await look(page, each, "resumed-on-test");

    const creates: (table: string) => Promise<number> = async (
      table: string,
    ): Promise<number> => {
      return (await writesTo(page, table)).filter((write: FixtureWrite) => {
        return write.kind === "create";
      }).length;
    };

    expect(await creates("Monitor")).toBe(1);
    expect(await creates("OnCallDutyPolicy")).toBe(1);
  });
}

/*
 * A test page nobody acknowledges: the dialog closes on Done, and "I did
 * not get it" says what to check, with the way to the person's methods.
 */
for (const width of [1280, 390]) {
  test(`a test page nobody acknowledged, ${width}px: I did not get it, in Persian`, async ({
    page,
  }: {
    page: Page;
  }) => {
    const each: Look = { lang: "fa", theme: "dark", width };

    await open(page, each, { test: "unanswered" });
    await walkToTheTest(page);
    await step(page, "test").getByTestId("send-test-page").click();

    const dialog: Locator = page.getByRole("dialog");

    await button(dialog, each.lang, "Send test page").click();
    await button(dialog, each.lang, "Done").click();
    await expect(dialog).toHaveCount(0);

    await page.getByTestId("guided-setup-did-not-get-it").click();
    await expect(page.getByTestId("guided-setup-not-received")).toBeVisible();
    await expect(step(page, "test")).toHaveAttribute("data-state", "open");
    await look(page, each, "3-test-did-not-get-it");
  });
}

/*
 * A self-hosted server that cannot send email yet: before the test, the
 * step says so, and its master admin gets Set up email; the test can be
 * skipped, and the summary follows.
 */
for (const width of [1280, 390]) {
  test(`a server that cannot send email, ${width}px: Set up email, then Skip the test, in German`, async ({
    page,
  }: {
    page: Page;
  }) => {
    const each: Look = { lang: "de", theme: "dark", width };

    await open(page, each, { as: "admin", email: "off" });
    await walkToTheTest(page);
    await expect(page.getByTestId("guided-setup-no-email")).toBeVisible();
    await expect(page.getByTestId("guided-setup-set-up-email")).toHaveText(
      words(each.lang, "Set up email"),
    );
    await look(page, each, "3-test-no-email");

    await page.getByTestId("guided-setup-skip-test").click();
    await expect(page.getByTestId("guided-setup-summary")).toBeVisible();
    await look(page, each, "5-summary-test-skipped");
  });
}

/*
 * A teammate's monitor already checks the address (#7254): the step says
 * whose, before it makes anything, and links it in a tab of its own; Create
 * my own monitor goes on with a monitor of this person's, and the
 * teammate's is left as it was.
 */
for (const width of [1280, 390]) {
  test(`a teammate's monitor for the address, ${width}px: named, then my own, in Persian`, async ({
    page,
  }: {
    page: Page;
  }) => {
    const each: Look = { lang: "fa", theme: "light", width };

    await open(page, each, { as: "member", seed: "teammate-monitor" });
    await page.getByTestId("guided-setup-address").fill(ADDRESS);
    await page.getByTestId("guided-setup-start-checking").click();

    const sentence: Locator = page.getByTestId(
      "guided-setup-other-monitor-sentence",
    );

    await expect(sentence).toContainText("Acme storefront");
    await expect(sentence).toContainText("Ada Lovelace");
    await expect(
      page.getByTestId("guided-setup-open-other-monitor"),
    ).toHaveAttribute("href", new RegExp(`/monitors/${TEAMMATE_MONITOR_ID}$`));
    await expect(
      page.getByTestId("guided-setup-open-other-monitor"),
    ).toHaveAttribute("target", "_blank");
    expect(await writesTo(page, "Monitor")).toHaveLength(0);
    await look(page, each, "1-check-teammate-monitor");

    await page.getByTestId("guided-setup-create-own-monitor").click();
    await expectTheFirstCheck(page);
    await expect(page.getByTestId("guided-setup-other-monitor")).toHaveCount(0);
    await look(page, each, "1-check-own-monitor");

    // One monitor made, this person's; the teammate's untouched (#7190).
    const made: Array<FixtureWrite> = (await writesTo(page, "Monitor")).filter(
      (write: FixtureWrite) => {
        return write.kind === "create";
      },
    );

    expect(made).toHaveLength(1);
    expect(String(made[0]?.data["_id"])).not.toBe(TEAMMATE_MONITOR_ID);

    for (const table of ["Monitor", "MonitorOwnerUser"]) {
      expect(
        (await writesTo(page, table)).filter((write: FixtureWrite) => {
          return JSON.stringify(write.data).includes(TEAMMATE_MONITOR_ID);
        }),
        `a write to the teammate's monitor, in ${table}`,
      ).toEqual([]);
    }
  });
}
