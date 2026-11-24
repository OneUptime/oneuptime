import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * WHAT A KEYBOARD AND A SCREEN READER GO THROUGH ON EVERY PAGE, IN A REAL
 * BROWSER (?section=a11y): at 1280 and 390 pixels, light and dark, and on a
 * Persian page, which reads right to left.
 *
 *   - The top bar, the trail and a side menu are three navigation
 *     landmarks with three names - "Main menu", "Breadcrumb", "Pages in
 *     this section" - in the reader's language (#7963). The side menu was
 *     "Main navigation" and the bar had none; its list was a navigation
 *     with no name inside it.
 *   - A confirmation whose body holds links opens on its action, so Enter
 *     does what it asks and never follows a link out of the page; a delete
 *     opens on Cancel (#7360).
 *   - A list's saved views: each view's Rename and Delete are menu items the
 *     arrow keys reach after the view, named with it, and work from the
 *     keyboard alone; the focus comes back to Saved Views after each dialog
 *     (#6922).
 *   - A secret's "Click to reveal" is a button found by its words, and the
 *     secret by its test id: no made-up role on either (#7964).
 */

const PORT: string = process.env["SHARED_UI_FIXTURE_PORT"] || "4329";

const ROUTE: string =
  "/dashboard/10000000-0000-4000-8000-000000000001/shared-ui";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/shared-ui",
);

const LOCALES: string = path.resolve(
  __dirname,
  "../../App/FeatureSet/Dashboard/src/Locales",
);

type Theme = "light" | "dark";
type Language = "en" | "fa";

const WIDTHS: Array<number> = [1280, 390];

interface FixtureRecord {
  reads: Array<unknown>;
  updates: Array<{ tableName: string; id: string; deleted?: boolean }>;
  unmodelled: Array<string>;
}

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });
  page.on("console", (message: { type: () => string; text: () => string }) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  // Nothing leaves the fixture's server.
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());

    if (target.hostname === "127.0.0.1" && target.port === PORT) {
      await route.continue();
      return;
    }

    await route.abort();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || []).toEqual([]);
  expect((await fixture(page)).unmodelled).toEqual([]);
});

async function fixture(page: Page): Promise<FixtureRecord> {
  return await page.evaluate((): FixtureRecord => {
    return (window as unknown as { __fixture: FixtureRecord }).__fixture;
  });
}

function wordsOf(language: Language): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

async function open(
  page: Page,
  options: { width: number; theme?: Theme; lang?: Language },
): Promise<void> {
  await page.setViewportSize({ width: options.width, height: 900 });
  const query: string = [
    "section=a11y",
    options.theme === "dark" ? "theme=dark" : "",
    options.lang && options.lang !== "en" ? `lang=${options.lang}` : "",
  ]
    .filter(Boolean)
    .join("&");
  await page.goto(`${ROUTE}?${query}`);
  await expect(page.getByTestId("section-a11y")).toBeVisible();
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
}

async function screenshot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `a11y-${name}.png`),
    fullPage: true,
    animations: "disabled",
  });
}

// The names of the page's navigation landmarks, as a screen reader lists them.
async function landmarkNames(page: Page): Promise<Array<string>> {
  return page
    .getByRole("navigation")
    .evaluateAll((landmarks: Array<Element>): Array<string> => {
      return landmarks.map((landmark: Element): string => {
        return landmark.getAttribute("aria-label") || "";
      });
    });
}

async function focusedName(page: Page): Promise<string> {
  return page.evaluate((): string => {
    const focused: Element | null = document.activeElement;

    return (
      focused?.getAttribute("aria-label") ||
      focused?.textContent ||
      ""
    ).trim();
  });
}

function savedViewsButton(page: Page): Locator {
  return page
    .getByTestId("section-a11y")
    .getByRole("button", { name: /^Saved view: |^Saved Views$/ });
}

// Down until the focus is on the menu item called `name`.
async function arrowTo(page: Page, name: string): Promise<void> {
  for (let step: number = 0; step < 12; step++) {
    if ((await focusedName(page)) === name) {
      return;
    }

    await page.keyboard.press("ArrowDown");
  }

  throw new Error(`The arrow keys never reached ${name}.`);
}

// Tab until the focus is on `target`.
async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let step: number = 0; step < 30; step++) {
    if (
      await target.evaluate((element: Element): boolean => {
        return element === document.activeElement;
      })
    ) {
      return;
    }

    await page.keyboard.press("Tab");
  }

  throw new Error("Tab never reached the control it was looking for.");
}

for (const width of WIDTHS) {
  for (const theme of ["light", "dark"] as Array<Theme>) {
    test(`at ${width}px (${theme}) the top bar, the trail and the side menu are three landmarks named apart`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, { width: width, theme: theme });

      if (width < 768) {
        /*
         * On a phone the side menu is a toggle until opened, and its panel
         * is the landmark; the bar is one landmark, open or not.
         */
        await page.getByTestId("mobile-sidemenu-toggle").click();
        await expect(
          page.getByRole("navigation", { name: "Pages in this section" }),
        ).toBeVisible();
      }

      const names: Array<string> = await landmarkNames(page);

      expect(names).toEqual([
        "Main menu",
        "Breadcrumb",
        "Pages in this section",
      ]);
      // None says "navigation": a screen reader says it after the name.
      for (const name of names) {
        expect(name.toLowerCase()).not.toContain("navigation");
      }

      await expectNoSidewaysScroll(page);
      await screenshot(page, `landmarks-${width}-${theme}`);
    });
  }
}

test("on a Persian page the three landmarks are named in Persian, apart", async ({
  page,
}: {
  page: Page;
}) => {
  const persian: Record<string, string> = wordsOf("fa");

  await open(page, { width: 1280, lang: "fa" });

  expect(await page.locator("html").getAttribute("dir")).toBe("rtl");
  expect(await landmarkNames(page)).toEqual([
    persian["Main menu"],
    persian["Breadcrumb"],
    persian["Pages in this section"],
  ]);
  expect(persian["Main menu"]).not.toBe("Main menu");
  await screenshot(page, "landmarks-1280-fa");
});

for (const width of WIDTHS) {
  test(`at ${width}px a confirmation with links opens on its action: Enter turns it on, and no link is followed`, async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { width: width });

    await tabTo(page, page.getByTestId("a11y-open-confirmation"));
    await page.keyboard.press("Enter");

    const dialog: Locator = page.getByRole("dialog");

    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByTestId("modal-footer-submit-button"),
    ).toBeFocused();
    await expect(dialog.getByRole("link")).toHaveCount(2);
    await screenshot(page, `confirmation-${width}`);

    const address: string = page.url();

    await page.keyboard.press("Enter");

    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("a11y-turned-on")).toHaveText("1");
    expect(page.url()).toBe(address);
    // The focus is back on the button that opened it.
    await expect(page.getByTestId("a11y-open-confirmation")).toBeFocused();
  });
}

test("a delete whose body holds a link opens on Cancel: Enter deletes nothing", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, { width: 1280, theme: "dark" });

  // The button that opens it, pressed with the keyboard.
  await page.getByTestId("a11y-open-delete").focus();
  await page.keyboard.press("Enter");

  const dialog: Locator = page.getByRole("dialog");

  await expect(dialog.getByTestId("modal-footer-close-button")).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("a11y-deleted")).toHaveText("0");
});

for (const width of WIDTHS) {
  for (const theme of ["light", "dark"] as Array<Theme>) {
    test(`at ${width}px (${theme}) a saved view is renamed and deleted with the keyboard alone`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, { width: width, theme: theme });

      const trigger: Locator = savedViewsButton(page);

      await expect(trigger).toHaveText(/Saved Views/);
      await tabTo(page, trigger);
      await page.keyboard.press("Enter");

      const menu: Locator = page.getByRole("menu");

      await expect(menu).toBeVisible();
      expect(await focusedName(page)).toBe("Errors");
      await expect(menu.getByRole("menuitem")).toHaveText([
        "Errors",
        "",
        "",
        "Offline monitors",
        "",
        "",
        "Save as New View",
      ]);
      expect(
        await menu
          .getByRole("menuitem")
          .evaluateAll((items: Array<Element>): Array<string> => {
            return items.map((item: Element): string => {
              return (
                item.getAttribute("aria-label") ||
                item.textContent ||
                ""
              ).trim();
            });
          }),
      ).toEqual([
        "Errors",
        "Rename view Errors",
        "Delete view Errors",
        "Offline monitors",
        "Rename view Offline monitors",
        "Delete view Offline monitors",
        "Save as New View",
      ]);
      // Inside the window, beside the view's name, on a phone too.
      await expectNoSidewaysScroll(page);
      await screenshot(page, `saved-views-menu-${width}-${theme}`);

      // Rename Errors.
      await page.keyboard.press("ArrowDown");
      expect(await focusedName(page)).toBe("Rename view Errors");
      await page.keyboard.press("Enter");

      const rename: Locator = page.getByRole("dialog");
      const name: Locator = rename.getByPlaceholder("Name of the view");

      await expect(name).toHaveValue("Errors");
      await expect(name).toBeFocused();
      await name.fill("Errors this week");
      await tabTo(page, rename.getByTestId("modal-footer-submit-button"));
      await page.keyboard.press("Enter");

      await expect(rename).toHaveCount(0);
      await expect(trigger).toBeFocused();

      // Delete Offline monitors.
      await page.keyboard.press("Enter");
      await expect(menu).toBeVisible();
      await arrowTo(page, "Delete view Offline monitors");
      await page.keyboard.press("Enter");

      const remove: Locator = page.getByRole("dialog");

      await expect(remove).toContainText(
        "Are you sure you want to delete Offline monitors?",
      );
      await expect(
        remove.getByTestId("modal-footer-close-button"),
      ).toBeFocused();
      await tabTo(page, remove.getByTestId("modal-footer-submit-button"));
      await page.keyboard.press("Enter");

      await expect(remove).toHaveCount(0);
      await expect(trigger).toBeFocused();

      // The menu reads back what the keyboard did.
      await page.keyboard.press("Enter");
      await expect(menu.getByRole("menuitem").first()).toHaveText(
        "Errors this week",
      );
      await expect(
        menu.getByRole("menuitem", { name: "Offline monitors" }),
      ).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();

      const updates: FixtureRecord["updates"] = (await fixture(page)).updates;

      expect(
        updates.filter((update: { tableName: string }): boolean => {
          return update.tableName === "TableView";
        }),
      ).toEqual([
        { tableName: "TableView", id: "44000000-0000-4000-8000-000000000001" },
        {
          tableName: "TableView",
          id: "44000000-0000-4000-8000-000000000002",
          deleted: true,
        },
      ]);
    });
  }
}

test("on a Persian page the saved views' row reads from the right, and Down walks it in order", async ({
  page,
}: {
  page: Page;
}) => {
  const persian: Record<string, string> = wordsOf("fa");

  await open(page, { width: 1280, lang: "fa" });

  // Named in Persian: Saved Views.
  const trigger: Locator = page
    .getByTestId("section-a11y")
    .getByRole("button", { name: persian["Saved Views"]!, exact: true });

  await expect(trigger).toBeVisible();
  await tabTo(page, trigger);
  await page.keyboard.press("Enter");

  const menu: Locator = page.getByRole("menu");
  const view: Locator = menu.getByRole("menuitem", {
    name: "Errors",
    exact: true,
  });
  const rename: Locator = menu.getByTestId("table-view-rename").first();

  await expect(rename).toBeVisible();

  // Named in Persian around the view's name, as written.
  const renameName: string = (await rename.getAttribute("aria-label")) || "";
  const sentence: string = persian["Rename view {{name}}"]!;

  expect(renameName).toContain("Errors");
  expect(renameName).toContain(sentence.replace("{{name}}", "").trim());
  // The view's name starts at the right, its actions after it, to its left.
  expect((await view.boundingBox())!.x).toBeGreaterThan(
    (await rename.boundingBox())!.x,
  );

  // Up and Down do not turn round on a page read from the right.
  expect(await focusedName(page)).toBe("Errors");
  await page.keyboard.press("ArrowDown");
  expect(await focusedName(page)).toBe(renameName);
  await screenshot(page, "saved-views-menu-1280-fa");
});

test("a secret's reveal is a button found by its words, and the revealed secret by its test id", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, { width: 390 });

  const reveal: Locator = page.getByRole("button", { name: "Click to reveal" });

  await expect(reveal).toHaveAttribute("data-testid", "hidden-text-reveal");
  await tabTo(page, reveal);
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("hidden-text-value")).toHaveText(
    "olk_live_7f3a9c2e5b1d48e0a6f2c9b7d3e1a5f8",
  );
  await expect(page.getByRole("button", { name: "Copy" })).toBeFocused();
  // No part carries a role that is no ARIA role.
  expect(
    await page.locator('[role="hidden-text"], [role="revealed-text"]').count(),
  ).toBe(0);
  await expectNoSidewaysScroll(page);
});
