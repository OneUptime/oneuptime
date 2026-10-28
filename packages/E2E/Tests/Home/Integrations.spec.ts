import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import {
  Browser,
  BrowserContext,
  Locator,
  Page,
  expect,
  test,
} from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * The website's OpenTelemetry integrations, as a visitor uses them: the
 * index at /integrations, whose search narrows the guides as you type, and
 * a guide's page, whose tabs switch, whose code blocks copy, and which still
 * shows every choice when its script does not run. Neither page may scroll
 * sideways on a phone. The pages are Home's (Routes.ts), so these checks run
 * only where the marketing site is deployed, as the other Home specs do.
 */

const GUIDE_PATH: string = "/integrations/opentelemetry/phoenix";

function pageUrl(route: string): string {
  return URL.fromString(BASE_URL.toString()).addRoute(route).toString();
}

// The cards the search leaves on the page.
function shownCards(page: Page): Locator {
  return page.locator("[data-integration-card]:not([hidden])");
}

async function shownCardLinks(page: Page): Promise<Array<string>> {
  return await shownCards(page)
    .locator("a")
    .evaluateAll((links: Array<Element>): Array<string> => {
      return links.map((link: Element): string => {
        return link.getAttribute("href") || "";
      });
    });
}

async function sidewaysScroll(page: Page): Promise<number> {
  return await page.evaluate((): number => {
    return (
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
    );
  });
}

test.describe("Home: OpenTelemetry integrations", () => {
  test("the index narrows the guides as you type, and says when none match", async ({
    page,
  }: {
    page: Page;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return; // Home marketing site is only deployed in the SaaS stack.
    }

    page.setDefaultNavigationTimeout(120000);
    await page.goto(pageUrl("/integrations"));

    const search: Locator = page.locator("[data-integrations-search]");
    const allCards: number = await page
      .locator("[data-integration-card]")
      .count();

    await expect(search).toBeVisible();
    expect(allCards).toBeGreaterThan(40);
    await expect(shownCards(page)).toHaveCount(allCards);

    // A framework by its name.
    await search.fill("phoenix");
    expect(await shownCardLinks(page)).toEqual([GUIDE_PATH]);
    await expect(page.locator("[data-integrations-count]")).toHaveText(
      "1 guide",
    );

    // A language by another name people type for it: every Elixir guide.
    await search.fill("erlang");
    expect(await shownCardLinks(page)).toEqual([
      "/integrations/opentelemetry/elixir",
      GUIDE_PATH,
    ]);
    await expect(
      page.locator("#elixir[data-integrations-group]"),
    ).toBeVisible();
    await expect(page.locator("#python[data-integrations-group]")).toBeHidden();

    // Nothing matches: the page says so, and points at the docs.
    await search.fill("cobol");
    await expect(shownCards(page)).toHaveCount(0);
    await expect(page.locator("[data-integrations-empty]")).toBeVisible();

    // Cleared, every guide is back.
    await search.fill("");
    await expect(shownCards(page)).toHaveCount(allCards);
    await expect(page.locator("[data-integrations-empty]")).toBeHidden();

    // A card opens its guide.
    await search.fill("phoenix");
    await shownCards(page).locator("a").first().click();
    await expect(page).toHaveURL(new RegExp(`${GUIDE_PATH}$`));
    await expect(page.locator("h1")).toHaveText("OpenTelemetry for Phoenix");
  });

  test("a guide's tabs switch together, and the choice is kept for the next guide", async ({
    page,
  }: {
    page: Page;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return;
    }

    page.setDefaultNavigationTimeout(120000);
    await page.goto(pageUrl(GUIDE_PATH));

    // The endpoint's tabs: OneUptime Cloud first, then self-hosted.
    const sets: Locator = page.locator('[data-tabs="deployment"]');
    const first: Locator = sets.first();
    const tabs: Locator = first.getByRole("tab");

    expect(await tabs.count()).toBeGreaterThan(1);
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
    await expect(first.getByRole("tabpanel").first()).toBeVisible();

    const second: Locator = tabs.nth(1);
    const secondName: string = ((await second.textContent()) || "").trim();
    await second.click();

    await expect(second).toHaveAttribute("aria-selected", "true");
    await expect(tabs.first()).toHaveAttribute("aria-selected", "false");
    await expect(
      first.locator(`[data-tab-panel][data-tab-value="${secondName}"]`),
    ).toBeVisible();
    // The arrow keys move between the tabs, as a tab list's do.
    await second.press("ArrowLeft");
    await expect(tabs.first()).toBeFocused();
    await tabs.first().press("ArrowRight");
    await expect(second).toBeFocused();

    // Another guide opens with the same choice.
    await page.goto(pageUrl("/integrations/opentelemetry/elixir"));
    await expect(
      page
        .locator('[data-tabs="deployment"]')
        .first()
        .getByRole("tab", { name: secondName }),
    ).toHaveAttribute("aria-selected", "true");
  });

  test("a guide's code block copies its code", async ({
    page,
    context,
    browserName,
  }: {
    page: Page;
    context: BrowserContext;
    browserName: string;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return;
    }
    test.skip(
      browserName !== "chromium",
      "Only Chromium lets a test grant the clipboard and read it back.",
    );

    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    page.setDefaultNavigationTimeout(120000);
    await page.goto(pageUrl(GUIDE_PATH));

    const block: Locator = page.locator("[data-code-block]").first();
    const button: Locator = block.locator("[data-copy-button]");
    const code: string = (await block.locator("code").textContent()) || "";

    expect(code.length).toBeGreaterThan(0);
    await expect(button).toBeVisible();
    await button.click();
    await expect(button).toHaveAttribute("data-copy-state", "copied");
    await expect(button.locator("[data-copy-label]")).toHaveText("Copied");

    // Where the async clipboard is there to read, it holds the code as shown.
    const copied: string | null = await page.evaluate(
      async (): Promise<string | null> => {
        if (!window.isSecureContext || !navigator.clipboard) {
          return null;
        }
        return await navigator.clipboard.readText();
      },
    );
    if (copied !== null) {
      expect(copied).toBe(code);
    }
  });

  test("neither the index nor a guide scrolls sideways on a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return;
    }

    page.setDefaultNavigationTimeout(120000);
    await page.setViewportSize({ width: 390, height: 844 });

    for (const route of ["/integrations", GUIDE_PATH]) {
      await page.goto(pageUrl(route));
      expect([route, await sidewaysScroll(page)]).toEqual([route, 0]);
    }
  });

  test("without its script, a guide shows every tab's choice under its name", async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return;
    }

    const context: BrowserContext = await browser.newContext({
      javaScriptEnabled: false,
    });

    try {
      const page: Page = await context.newPage();
      page.setDefaultNavigationTimeout(120000);
      await page.goto(pageUrl(GUIDE_PATH));

      const set: Locator = page.locator('[data-tabs="deployment"]').first();

      // The buttons cannot switch, so they are gone...
      await expect(set.getByRole("tablist")).toBeHidden();
      // ...and every choice is shown, each under its name.
      const panels: Locator = set.locator("[data-tab-panel]");
      const labels: Locator = set.locator("[data-tab-label]");
      expect(await panels.count()).toBeGreaterThan(1);
      await expect(labels).toHaveCount(await panels.count());
      for (let index: number = 0; index < (await panels.count()); index++) {
        await expect(panels.nth(index)).toBeVisible();
        await expect(labels.nth(index)).toBeVisible();
        await expect(labels.nth(index)).toHaveText(
          (await panels.nth(index).getAttribute("data-tab-value")) || "",
        );
      }
    } finally {
      await context.close();
    }
  });
});
