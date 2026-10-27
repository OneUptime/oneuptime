import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";
import { boxesInOneFrame, FrameBox } from "../SuiteHelpers/Frames";

/*
 * A runbook's side menu in a browser, around the real pages, against the
 * offline fixture's ?menu=1 mode: the runbook's real view layout (header,
 * breadcrumbs, side menu) stays mounted while its pages change, as in the
 * Dashboard.
 *
 * The maintainer: "move executions to logs in the side menu, in the log
 * section, which should be collapsed by default ... move triggers to the
 * settings side menu, which should also be collapsed by default ... show as
 * little stuff as possible to the user, so it reduces decision paralysis."
 *
 * jsdom applies no CSS, so it can only read the classes a folded section
 * carries. Here a folded Executions or Triggers is checked to be out of
 * sight and out of the keyboard's way, each section opens from a click and
 * from the keyboard and leads to its pages, a section opens by itself on a
 * page inside it - a run's page included - and the phone menu opens a
 * section without closing. The same steps open Triggers here as in the
 * deployed suite (Tests/Dashboard/RunbookTriggers.spec.ts).
 *
 * The runbook opens on its real Overview, whose Activity card is the way to
 * the runs that is always in sight: Last Run and Total Runs are links
 * stretched over their tiles, clicked here where a person clicks them,
 * reached from the keyboard, and the last run's own incident link still
 * opens the incident.
 */

const PORT: string = process.env["RUNBOOK_TRIGGERS_FIXTURE_PORT"] || "4327";
const PROJECT_ID: string = "10000000-0000-4000-8000-0000000000a1";
const RUNBOOK_ID: string = "20000000-0000-4000-8000-0000000000b1";
const WEBHOOK_RUN_ID: string = "40000000-0000-4000-8000-0000000000d1";
const RUNBOOK_PATH: string = `/dashboard/${PROJECT_ID}/runbooks/${RUNBOOK_ID}`;
const EXECUTIONS_PATH: string = `${RUNBOOK_PATH}/executions`;
const TRIGGERS_PATH: string = `${RUNBOOK_PATH}/triggers`;
const SETTINGS_PATH: string = `${RUNBOOK_PATH}/settings`;
// The incident the fixture's ?lastrunby=incident run was started for.
const INCIDENT_PATH: string = `/dashboard/${PROJECT_ID}/incidents/70000000-0000-4000-8000-0000000000a7`;

/*
 * The Overview's Activity tiles that lead to the runs, and their links
 * (RunbookOverviewState in the Dashboard's Components/Runbook).
 */
const LAST_RUN_TILE: string = "runbook-last-run";
const LAST_RUN_LINK: string = "runbook-last-run-link";
const TOTAL_RUNS_TILE: string = "runbook-total-runs";
const TOTAL_RUNS_LINK: string = "runbook-total-runs-link";

const SECTIONS: ReadonlyArray<string> = [
  "Basic",
  "Logs",
  "Owners",
  "Settings",
  "Developer",
  "Advanced",
];
const FOLDED: ReadonlyArray<string> = SECTIONS.slice(1);

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/runbook-triggers-ui",
);

const pageErrors: Map<Page, Array<string>> = new Map();
const leftTheFixture: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  const aborted: Array<string> = [];
  pageErrors.set(page, errors);
  leftTheFixture.set(page, aborted);
  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });

  // Nothing may leave the fixture server.
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());
    if (target.hostname === "127.0.0.1" && target.port === PORT) {
      await route.continue();
      return;
    }
    aborted.push(route.request().url());
    await route.abort();
  });
});

test.afterEach(({ page }: { page: Page }) => {
  // A page that threw while drawing is a bug even when the test passed.
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
  expect(
    leftTheFixture.get(page) || [],
    "requests that left the fixture server",
  ).toEqual([]);
});

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `menu-${name}-synthetic.png`),
    fullPage: true,
    animations: "disabled",
  });
}

// The fixture with the real layout, on one of its pages.
async function openRunbook(
  page: Page,
  which: "overview" | "triggers" | "executions" | "execution",
  search: string = "",
): Promise<void> {
  await page.goto(
    `${RUNBOOK_PATH}?menu=1&page=${which}${search ? `&${search}` : ""}`,
  );
  // The first load parses a large bundle; the header names the runbook.
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Restart the web tier",
    { timeout: 60000 },
  );
}

function desktopMenu(page: Page): Locator {
  return page.locator("aside[role='navigation'][aria-label='Main navigation']");
}

function phoneMenu(page: Page): Locator {
  return page.locator("div[role='navigation'][aria-label='Main navigation']");
}

// A section's toggle, by its heading's text (CSS draws it in capitals).
function sectionToggle(menu: Locator, title: string): Locator {
  return menu.locator(
    `xpath=.//h6[normalize-space(.)='${title}']/ancestor::button[1]`,
  );
}

function link(menu: Locator, href: string): Locator {
  return menu.locator(`a[href='${href}']`);
}

// Whether a menu entry is drawn as the page you are on.
async function isMarked(entry: Locator): Promise<boolean> {
  return await entry.evaluate((element: Element): boolean => {
    return element.classList.contains("bg-indigo-50");
  });
}

async function expectFolded(menu: Locator, title: string): Promise<void> {
  await expect(sectionToggle(menu, title)).toHaveAttribute(
    "aria-expanded",
    "false",
  );
}

async function expectOpen(menu: Locator, title: string): Promise<void> {
  await expect(sectionToggle(menu, title)).toHaveAttribute(
    "aria-expanded",
    "true",
  );
}

// The page's address, without the fixture's query string.
async function expectPath(page: Page, pathname: string): Promise<void> {
  await expect
    .poll((): string => {
      return new URL(page.url()).pathname;
    })
    .toBe(pathname);
}

function crumbs(page: Page): Locator {
  return page.getByRole("navigation", { name: "Breadcrumb" });
}

/*
 * A person's click at the middle of an element. Playwright's own click
 * refuses an element another one covers, and covering its tile is what a
 * stretched link is for.
 */
async function clickAt(page: Page, target: Locator): Promise<void> {
  const box: { x: number; y: number; width: number; height: number } | null =
    await target.boundingBox();

  expect(box, "the element to click is drawn").not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
}

test.describe("a runbook's side menu", () => {
  test("on the Overview only Basic is open: Executions and Triggers are out of sight", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRunbook(page, "overview");
    const menu: Locator = desktopMenu(page);

    await expect(menu.locator("h6")).toHaveText(Array.from(SECTIONS));
    await expectOpen(menu, "Basic");
    await expect(link(menu, RUNBOOK_PATH)).toBeVisible();
    await expect(link(menu, `${RUNBOOK_PATH}/steps`)).toBeVisible();

    for (const title of FOLDED) {
      await expectFolded(menu, title);
    }

    await expect(link(menu, EXECUTIONS_PATH)).toBeHidden();
    await expect(link(menu, TRIGGERS_PATH)).toBeHidden();
    await expect(link(menu, SETTINGS_PATH)).toBeHidden();
    expect(await isMarked(link(menu, RUNBOOK_PATH))).toBe(true);

    await screenshot(page, "overview");
  });

  test("the keyboard passes the folded sections' rows by", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRunbook(page, "overview");
    const menu: Locator = desktopMenu(page);

    await sectionToggle(menu, "Basic").focus();

    /*
     * Every stop in the menu, until the keyboard leaves it for the page
     * (whose Total Runs links to the runs too, from the Overview itself).
     */
    const reached: Array<string> = [];
    for (let press: number = 0; press < 12; press++) {
      await page.keyboard.press("Tab");
      const stop: string | null = await page.evaluate((): string | null => {
        const focused: Element | null = document.activeElement;
        if (!focused?.closest("aside[role='navigation']")) {
          return null;
        }
        return (
          focused.getAttribute("href") || focused.textContent?.trim() || ""
        );
      });
      if (stop === null) {
        break;
      }
      reached.push(stop);
    }

    // Basic's two rows, then the five folded sections' titles: nothing else.
    expect(reached).toEqual([RUNBOOK_PATH, `${RUNBOOK_PATH}/steps`, ...FOLDED]);
    expect(reached).not.toContain(EXECUTIONS_PATH);
    expect(reached).not.toContain(TRIGGERS_PATH);
    expect(reached).not.toContain(SETTINGS_PATH);
  });

  test("Logs opens with a click, and Executions leads to the runs with Logs kept open", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRunbook(page, "overview");
    const menu: Locator = desktopMenu(page);

    await sectionToggle(menu, "Logs").click();
    await expectOpen(menu, "Logs");
    await expect(link(menu, EXECUTIONS_PATH)).toBeVisible();

    await link(menu, EXECUTIONS_PATH).click();
    await expectPath(page, EXECUTIONS_PATH);
    // The real runs list, under the trail that names it.
    await expect(page.locator("tbody tr")).toHaveCount(4);
    await expect(crumbs(page)).toContainText("Executions");
    expect(await isMarked(link(menu, EXECUTIONS_PATH))).toBe(true);
    await expectOpen(menu, "Logs");
    await expectFolded(menu, "Settings");

    // Back to the Overview: the menu stays as it was left.
    await link(menu, RUNBOOK_PATH).click();
    await expectPath(page, RUNBOOK_PATH);
    await expect(page.getByTestId(TOTAL_RUNS_TILE)).toBeVisible();
    await expectOpen(menu, "Logs");
    expect(await isMarked(link(menu, RUNBOOK_PATH))).toBe(true);
  });

  test("Settings opens with a click, as the deployed suite opens it, and Triggers leads to the schedule and webhook", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRunbook(page, "overview");
    const menu: Locator = desktopMenu(page);
    const settings: Locator = sectionToggle(menu, "Settings");
    const triggers: Locator = link(menu, TRIGGERS_PATH);

    await expect(settings).toHaveAttribute("aria-expanded", "false");
    await expect(triggers).toBeHidden();
    await settings.click();
    await expect(settings).toHaveAttribute("aria-expanded", "true");
    // Triggers first, then the runbook's Settings page.
    await expect(triggers).toBeVisible();
    await expect(link(menu, SETTINGS_PATH)).toBeVisible();
    // In one frame: the section has only just opened.
    const [triggersBox, settingsBox] = (await boxesInOneFrame([
      triggers,
      link(menu, SETTINGS_PATH),
    ])) as [FrameBox, FrameBox];
    expect(triggersBox.y).toBeLessThan(settingsBox.y);

    await triggers.click();
    await expectPath(page, TRIGGERS_PATH);
    await expect(page.getByTestId("runbook-schedule-card")).toBeVisible();
    await expect(page.getByTestId("runbook-webhook-card")).toBeVisible();
    await expect(crumbs(page)).toContainText("Triggers");
    expect(await isMarked(triggers)).toBe(true);
    await expectOpen(menu, "Settings");
    await expectFolded(menu, "Logs");

    await screenshot(page, "triggers");
  });

  test("a section opens from the keyboard, and its row is the next stop", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRunbook(page, "overview");
    const menu: Locator = desktopMenu(page);

    await sectionToggle(menu, "Settings").focus();
    await page.keyboard.press("Enter");
    await expectOpen(menu, "Settings");

    await page.keyboard.press("Tab");
    await expect(link(menu, TRIGGERS_PATH)).toBeFocused();
    await page.keyboard.press("Enter");
    await expectPath(page, TRIGGERS_PATH);
    await expect(page.getByTestId("runbook-schedule-card")).toBeVisible();
  });

  test("a run's page opens Logs by itself, with Executions marked", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRunbook(page, "execution");
    const menu: Locator = desktopMenu(page);

    await expectPath(page, `${EXECUTIONS_PATH}/${WEBHOOK_RUN_ID}`);
    await expect(page.getByTestId("runbook-run-trigger")).toContainText(
      "From 203.0.113.24",
    );
    await expectOpen(menu, "Logs");
    await expect(link(menu, EXECUTIONS_PATH)).toBeVisible();
    expect(await isMarked(link(menu, EXECUTIONS_PATH))).toBe(true);
    expect(await isMarked(link(menu, RUNBOOK_PATH))).toBe(false);
    await expectFolded(menu, "Settings");
    await expect(crumbs(page)).toContainText("Execution");

    await screenshot(page, "run");
  });

  test("a bookmarked Triggers page opens Settings by itself; Logs stays folded", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRunbook(page, "triggers");
    const menu: Locator = desktopMenu(page);

    await expectOpen(menu, "Settings");
    await expect(link(menu, TRIGGERS_PATH)).toBeVisible();
    expect(await isMarked(link(menu, TRIGGERS_PATH))).toBe(true);
    await expectFolded(menu, "Logs");
    await expect(link(menu, EXECUTIONS_PATH)).toBeHidden();
  });

  test("dark mode draws the folded headings and the open section on the dark surface", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRunbook(page, "triggers", "theme=dark");
    const menu: Locator = desktopMenu(page);

    await expectOpen(menu, "Settings");
    const surface: string = await menu
      .locator("div.rounded-xl")
      .first()
      .evaluate((element: Element): string => {
        return getComputedStyle(element).backgroundColor;
      });
    expect(surface).not.toBe("rgb(255, 255, 255)");

    await screenshot(page, "triggers-dark");
  });
});

/*
 * With Executions folded under Logs, the Overview's Activity card is the way
 * to the runs that is always in sight: Last Run opens that run, Total Runs
 * the list of every run. Each is a link stretched over its tile, which the
 * keyboard reaches; what started the last run keeps its own link.
 */
test.describe("the Overview's way to the runs", () => {
  test("a click anywhere on Total Runs opens every run, with Logs opened by itself", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRunbook(page, "overview");
    const menu: Locator = desktopMenu(page);
    const tile: Locator = page.getByTestId(TOTAL_RUNS_TILE);

    await expect(tile).toContainText("4");
    await expectFolded(menu, "Logs");

    // On the count, away from the link's own words.
    await clickAt(page, tile.getByText("4", { exact: true }));

    await expectPath(page, EXECUTIONS_PATH);
    await expect(page.locator("tbody tr")).toHaveCount(4);
    await expectOpen(menu, "Logs");
    expect(await isMarked(link(menu, EXECUTIONS_PATH))).toBe(true);
  });

  test("a click on Last Run opens that run, with Executions marked", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRunbook(page, "overview");
    const menu: Locator = desktopMenu(page);
    const tile: Locator = page.getByTestId(LAST_RUN_TILE);

    // On the words saying what started it: they let the click through.
    await clickAt(page, tile.getByText("From 203.0.113.24"));

    await expectPath(page, `${EXECUTIONS_PATH}/${WEBHOOK_RUN_ID}`);
    await expect(page.getByTestId("runbook-run-trigger")).toContainText(
      "From 203.0.113.24",
    );
    await expectOpen(menu, "Logs");
    expect(await isMarked(link(menu, EXECUTIONS_PATH))).toBe(true);
  });

  test("the keyboard reaches Last Run, then Total Runs, ringing the tile, and Enter opens the runs", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRunbook(page, "overview");
    await expect(page.getByTestId(TOTAL_RUNS_TILE)).toContainText("4");

    await page.getByRole("button", { name: "Run Now" }).focus();

    const reached: Array<string> = [];
    for (let press: number = 0; press < 6; press++) {
      await page.keyboard.press("Tab");
      const testId: string = await page.evaluate((): string => {
        return document.activeElement?.getAttribute("data-testid") || "";
      });
      reached.push(testId);
      if (testId === TOTAL_RUNS_LINK) {
        break;
      }
    }

    expect(reached).toContain(LAST_RUN_LINK);
    expect(reached[reached.length - 1]).toBe(TOTAL_RUNS_LINK);
    expect(reached.indexOf(LAST_RUN_LINK)).toBeLessThan(
      reached.indexOf(TOTAL_RUNS_LINK),
    );

    // The focus ring is drawn by the link's ::after, round its whole tile.
    const ring: { shadow: string; covers: boolean } = await page
      .getByTestId(TOTAL_RUNS_LINK)
      .evaluate((element: Element): { shadow: string; covers: boolean } => {
        const after: CSSStyleDeclaration = getComputedStyle(element, "::after");
        const tile: Element = element.closest(
          "[data-testid='runbook-total-runs']",
        ) as Element;
        const tileBox: DOMRect = tile.getBoundingClientRect();
        return {
          shadow: after.boxShadow,
          covers:
            after.position === "absolute" &&
            Math.abs(parseFloat(after.width) - tileBox.width) <= 2 &&
            Math.abs(parseFloat(after.height) - tileBox.height) <= 2,
        };
      });
    expect(ring.shadow).not.toBe("none");
    expect(ring.covers).toBe(true);

    await page.keyboard.press("Enter");
    await expectPath(page, EXECUTIONS_PATH);
    await expectOpen(desktopMenu(page), "Logs");
  });

  test("an incident that started the last run opens from its own link inside the tile", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRunbook(page, "overview", "lastrunby=incident");
    const tile: Locator = page.getByTestId(LAST_RUN_TILE);
    const incident: Locator = tile.getByRole("link", {
      name: "Checkout is down",
    });

    await expect(incident).toBeVisible();
    await incident.click();

    // The incident's page, not the run the tile links to.
    await expectPath(page, INCIDENT_PATH);
    await expect(page.getByTestId("fixture-page-not-modelled")).toHaveText(
      INCIDENT_PATH,
    );
  });

  test("in German, the Outcomes counts stay inside their tile", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRunbook(page, "overview", "lang=de");
    const tile: Locator = page
      .getByText("Ergebnisse", { exact: true })
      .locator("xpath=..");

    await expect(tile).toContainText("fehlgeschlagen");

    const pastTheEdge: Array<string> = await tile.evaluate(
      (element: Element): Array<string> => {
        const right: number = element.getBoundingClientRect().right;
        return Array.from(element.querySelectorAll("span"))
          .filter((span: Element): boolean => {
            return span.getBoundingClientRect().right > right + 0.5;
          })
          .map((span: Element): string => {
            return span.textContent || "";
          });
      },
    );
    expect(pastTheEdge).toEqual([]);

    await screenshot(page, "overview-de");
  });
});

/*
 * What starts the runbook on its own, said on its Overview: its Triggers
 * page sits in the menu's folded Settings section, so the Overview says
 * whether a schedule or the webhook starts it - or neither, and what does -
 * and links to the Triggers page.
 */
test.describe("the Overview says what starts the runbook", () => {
  const summary: (page: Page) => Locator = (page: Page): Locator => {
    return page.getByTestId("runbook-overview-triggers");
  };

  test("a schedule that is on: when it runs, in its time zone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRunbook(page, "overview", "schedule=weekdays");

    // As the Triggers page's schedule card says it, in the browser's clock.
    await expect(summary(page)).toContainText(
      "Runs every weekday at 09:00 · Europe/London",
    );
    await expect(summary(page)).not.toContainText("No schedule or webhook");
  });

  test("a webhook that is on, beside a schedule that is: a line each, and never the URL", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRunbook(page, "overview", "schedule=every15&webhook=on");

    const lines: Array<string> = await summary(page)
      .locator("p[data-testid]")
      .allTextContents();

    expect(lines).toEqual([
      "Runs every 15 minutes · UTC",
      "Runs when its webhook URL is called.",
    ]);
    await expect(summary(page)).not.toContainText("http");
  });

  /*
   * A paused schedule is a schedule: it never reads "No schedule or
   * webhook". With nothing else to start the runbook, one line says both.
   */
  test("a paused schedule says so, and what starts the runbook meanwhile, in one line", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRunbook(page, "overview", "schedule=paused");

    const lines: Array<string> = await summary(page)
      .locator("p[data-testid]")
      .allTextContents();

    expect(lines).toEqual([
      "Its schedule is paused, so it runs only when someone starts it, or when a rule or OneUptime AI does.",
    ]);
    await expect(summary(page)).not.toContainText("No schedule or webhook");
  });

  test("a paused schedule beside a webhook that is on: the webhook first, then the paused schedule", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRunbook(page, "overview", "schedule=paused&webhook=on");

    const lines: Array<string> = await summary(page)
      .locator("p[data-testid]")
      .allTextContents();

    expect(lines).toEqual([
      "Runs when its webhook URL is called.",
      "Its schedule is paused.",
    ]);
  });

  test("neither: what does start it, and the link opens Triggers with Settings opened by itself", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRunbook(page, "overview");
    const menu: Locator = desktopMenu(page);

    await expect(summary(page)).toContainText(
      "No schedule or webhook: it runs when someone starts it, or when a rule or OneUptime AI does.",
    );
    await expectFolded(menu, "Settings");

    await summary(page)
      .getByRole("link", { name: "Settings › Triggers" })
      .click();

    await expectPath(page, TRIGGERS_PATH);
    await expectOpen(menu, "Settings");
    expect(await isMarked(link(menu, TRIGGERS_PATH))).toBe(true);
  });

  test("in German, as the German menu names the page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRunbook(page, "overview", "lang=de&webhook=on");

    await expect(summary(page)).toContainText(
      "Läuft, wenn seine Webhook-URL aufgerufen wird.",
    );
    await expect(
      summary(page).getByRole("link", { name: "Einstellungen › Auslöser" }),
    ).toBeVisible();
  });

  test("on a phone it stays inside its card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openRunbook(page, "overview", "schedule=cron&webhook=on");

    await expect(summary(page)).toBeVisible();

    const pastTheEdge: number = await page.evaluate((): number => {
      return document.documentElement.scrollWidth - window.innerWidth;
    });

    expect(pastTheEdge).toBeLessThanOrEqual(0);
    await screenshot(page, "overview-triggers-phone");
  });
});

test.describe("a runbook's side menu on a phone", () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test("the menu button names Settings / Triggers, and Logs opens without closing the menu", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRunbook(page, "triggers");

    const toggle: Locator = page.getByTestId("mobile-sidemenu-toggle");
    await expect(toggle).toContainText("Settings / Triggers");

    await toggle.click();
    const menu: Locator = phoneMenu(page);
    await expect(menu).toBeVisible();
    await expectOpen(menu, "Settings");
    await expectFolded(menu, "Logs");

    await sectionToggle(menu, "Logs").click();
    // Opening a section is not leaving the menu.
    await expect(menu).toBeVisible();
    await expectOpen(menu, "Logs");

    await link(menu, EXECUTIONS_PATH).click();
    await expectPath(page, EXECUTIONS_PATH);
    await expect(page.getByTestId("mobile-sidemenu-toggle")).toContainText(
      "Logs / Executions",
    );
    // Following a link closes the menu.
    await expect(phoneMenu(page)).toHaveCount(0);

    await screenshot(page, "phone-executions");
  });

  test("on a run's page, the menu button says Logs / Executions", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRunbook(page, "execution");

    await expect(page.getByTestId("mobile-sidemenu-toggle")).toContainText(
      "Logs / Executions",
    );
  });
});
