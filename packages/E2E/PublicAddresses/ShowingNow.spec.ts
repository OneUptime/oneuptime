import { expect, Locator, Page, Route, test } from "@playwright/test";
import fs from "fs/promises";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * "SHOWING NOW" ON THE REAL STATUS PAGE OVERVIEW (#7438).
 *
 * A status page's Overview says what visitors see on it right now: its
 * open incidents, each with its number, and the maintenance coming up or in
 * progress - each a link to its own page, and what the member may not see
 * counted, never named (UsedByService, #6813). The fixture answers GET
 * /used-by/status-page/:id as UsedByService does (?usedBy=used); the card's
 * rules are held by jsdom (Common/Tests/App/Dashboard/UsedByCard.test.tsx).
 * Checked at 1280 and 390, light and dark, in German and in Persian;
 * screenshots go to output/playwright/public-addresses-ui.
 */

const PROJECT: string = "10000000-0000-4000-8000-000000000001";
const STATUS_PAGE_ID: string = "30000000-0000-4000-8000-000000000001";
const DASHBOARD: string = `/dashboard/${PROJECT}`;
const STATUS_PAGE: string = `${DASHBOARD}/status-pages/${STATUS_PAGE_ID}`;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/public-addresses-ui",
);

const pageErrors: Map<Page, Array<string>> = new Map();

test.use({ deviceScaleFactor: 2 });

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });
  // Nothing may leave the fixture server.
  await page.route("**/*", async (route: Route) => {
    const url: URL = new URL(route.request().url());

    if (url.hostname !== "127.0.0.1") {
      await route.abort();
      return;
    }

    await route.continue();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
  // Every read the page made is one the fixture answers as the API does.
  expect(
    await page.evaluate((): Array<unknown> => {
      return (
        window as unknown as { __fixture: { unmodelled: Array<unknown> } }
      ).__fixture.unmodelled;
    }),
  ).toEqual([]);
});

async function open(
  page: Page,
  options: {
    theme?: "dark";
    lang?: "de" | "fa";
    width?: number;
  } = {},
): Promise<Locator> {
  const width: number = options.width || 1280;
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  const query: URLSearchParams = new URLSearchParams({ usedBy: "used" });
  if (options.theme) {
    query.set("theme", options.theme);
  }
  if (options.lang) {
    query.set("lang", options.lang);
  }
  await page.goto(`${STATUS_PAGE}?${query}`);
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
  const card: Locator = page.getByTestId("used-by-card");
  // The first load parses a large bundle.
  await expect(card).toBeVisible({ timeout: 60000 });
  await expect(card.getByTestId("used-by-loading")).toHaveCount(0, {
    timeout: 30000,
  });
  return card;
}

// The card's frame: the Card around the card's body.
function frame(card: Locator): Locator {
  return card.locator("xpath=ancestor::*[@data-testid='card'][1]");
}

async function shoot(locator: Locator, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await locator.scrollIntoViewIfNeeded();
  await locator.screenshot({
    // Synthetic: every record in it is made up, as the suite names them.
    path: path.join(SCREENSHOTS, `showing-now-${name}-synthetic.png`),
  });
}

test.describe("Showing now on the status page overview", () => {
  test("lists the open incidents by number, the maintenance coming up, and what the member may not see", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await open(page);
    const groups: Locator = card.getByTestId("used-by-group");

    await expect(frame(card)).toContainText("Showing now");
    await expect(groups).toHaveCount(2);
    expect(
      await groups.evaluateAll((elements: Array<Element>): Array<string> => {
        return elements.map((element: Element): string => {
          return element.getAttribute("data-relation") || "";
        });
      }),
    ).toEqual(["StatusPageOpenIncidents", "StatusPageMaintenance"]);

    // Newest first, each with its number, and one more counted, not named.
    const incidents: Locator = groups.nth(0);
    await expect(incidents).toContainText("Open incidents");
    await expect(incidents.getByTestId("used-by-count")).toHaveText("2");
    await expect(incidents.getByTestId("used-by-row")).toHaveText([
      "INC-41 Checkout API returning errors",
      "INC-40 Card payments slow in Europe",
    ]);
    await expect(incidents.getByTestId("used-by-hidden")).toHaveText(
      "and 1 you can't see",
    );
    await expect(
      incidents.getByRole("link", {
        name: "INC-41 Checkout API returning errors",
      }),
    ).toHaveAttribute(
      "href",
      `${DASHBOARD}/incidents/31300000-0000-4000-8000-000000000041`,
    );

    const maintenance: Locator = groups.nth(1);
    await expect(maintenance).toContainText(
      "Maintenance coming up or in progress",
    );
    await expect(
      maintenance.getByRole("link", { name: "SM-7 Database upgrade" }),
    ).toHaveAttribute(
      "href",
      `${DASHBOARD}/scheduled-maintenance-events/31300000-0000-4000-8000-000000000007`,
    );

    await shoot(frame(card), "1280");
  });

  test("reads in the dark theme, and fits a phone with no sideways scroll", async ({
    page,
  }: {
    page: Page;
  }) => {
    const wide: Locator = await open(page, { theme: "dark" });

    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(wide.getByTestId("used-by-row")).toHaveCount(3);
    await shoot(frame(wide), "1280-dark");

    const phone: Locator = await open(page, { width: 390 });

    await expect(phone.getByTestId("used-by-row")).toHaveCount(3);
    await expectNoSidewaysScroll(page);
    await shoot(frame(phone), "390");

    const darkPhone: Locator = await open(page, { width: 390, theme: "dark" });

    await expect(darkPhone.getByTestId("used-by-row")).toHaveCount(3);
    await expectNoSidewaysScroll(page);
    await shoot(frame(darkPhone), "390-dark");
  });

  test("reads in German and Persian", async ({ page }: { page: Page }) => {
    const german: Locator = await open(page, { lang: "de" });

    await expect(frame(german)).toContainText("Jetzt angezeigt");
    await expect(german.getByTestId("used-by-group").nth(0)).toContainText(
      "Offene Vorfälle",
    );
    await expect(
      german.getByTestId("used-by-group").nth(0).getByTestId("used-by-hidden"),
    ).toHaveText("und 1 für Sie nicht sichtbar");
    // A number and a name are the project's own: never translated.
    await expect(german.getByTestId("used-by-row").first()).toHaveText(
      "INC-41 Checkout API returning errors",
    );
    await shoot(frame(german), "de-1280");

    const persian: Locator = await open(page, { lang: "fa", width: 390 });

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(frame(persian)).toContainText("در حال نمایش");
    await expect(persian.getByTestId("used-by-group").nth(0)).toContainText(
      "حوادث باز",
    );
    await expectNoSidewaysScroll(page);
    await shoot(frame(persian), "fa-390");
  });
});
