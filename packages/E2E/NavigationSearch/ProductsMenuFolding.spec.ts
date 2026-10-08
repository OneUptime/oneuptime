import { expect, Locator, Page, test } from "@playwright/test";

/*
 * The products menu opens on the essentials instead of every product.
 *
 * Every section of the Dashboard's menu is a row of one list: its icon, its
 * name, what its products are called, how many and a chevron. The menu
 * always opens with the first row, its seven Essentials, open, their cards
 * under the row: folding them lasts until the menu closes, and no
 * remembered fold hides them. Every other section starts folded. A click
 * anywhere on a row, or Enter on it, opens or folds it; search ignores
 * folding; the section of the page the user is on opens by itself; and what
 * someone opens or folds among the other sections is remembered on their
 * browser. On a phone the menu toggle lists the products the same way.
 *
 * These run the production menu and catalog in a real browser, where layout
 * is real: the list's columns line its rows up, a folded row is one line, a
 * click on its list of products hits the row's button, and the arrow keys
 * move by where rows are drawn.
 */

const projectPath: string = "/dashboard/00000000-0000-4000-8000-000000000001";

const ESSENTIALS: Array<string> = [
  "Monitors",
  "Incidents",
  "Alerts",
  "On-Call Duty",
  "Status Pages",
  "Scheduled Maintenance",
  "SLOs",
];

const FOLDED_SECTIONS: Array<string> = [
  "Observability",
  "AI",
  "Code",
  "Resources",
  "Infrastructure",
  "Dashboards & Automation",
  "Settings",
];

// Every section, as the rows of the list: Essentials first.
const SECTIONS: Array<string> = ["Essentials", ...FOLDED_SECTIONS];

// Where the menu remembers the sections someone opened or folded.
const FOLDS_STORAGE_KEY: string = "oneuptime-navbar-product-categories";

const productsMenu: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByRole("dialog", { name: "Products menu" });
};

const sectionToggle: (page: Page, name: string) => Locator = (
  page: Page,
  name: string,
): Locator => {
  return productsMenu(page).getByRole("button", { name, exact: true });
};

// The heading of a section's row, with the button that folds it inside.
const sectionHeading: (page: Page, name: string) => Locator = (
  page: Page,
  name: string,
): Locator => {
  return productsMenu(page).getByRole("heading", { name, exact: true });
};

// The whole row of a section: the element its heading button's ::after covers.
const sectionLine: (page: Page, name: string) => Locator = (
  page: Page,
  name: string,
): Locator => {
  return sectionToggle(page, name).locator(
    "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' relative ')][1]",
  );
};

// What a folded section's row says it holds.
const sectionProducts: (page: Page, name: string) => Locator = (
  page: Page,
  name: string,
): Locator => {
  return sectionLine(page, name).locator('[id^="navbar-category-summary-"]');
};

// The count drawn on a section's row.
const sectionCount: (page: Page, name: string) => Locator = (
  page: Page,
  name: string,
): Locator => {
  return sectionLine(page, name).locator(
    'span[aria-hidden="true"].rounded-full',
  );
};

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const boxOf: (locator: Locator) => Promise<Box> = async (
  locator: Locator,
): Promise<Box> => {
  const box: Box | null = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
};

// One line of text at the menu's sizes: 20px, with a pixel of slack.
const ONE_LINE: number = 21;

// A navbar link, by the start of its name, as the other navbar specs find them.
const navLink: (scope: Locator, title: string) => Locator = (
  scope: Locator,
  title: string,
): Locator => {
  return scope.getByRole("link", {
    name: new RegExp(`^${title}(?:\\s|$)`),
  });
};

/*
 * The menu opens with a short zoom and fade (NavBarMenuModal). A box read
 * while it plays is scaled, and boxes read one after another are scaled by
 * different amounts, so rows that line up seem not to. Measure only once
 * the panel is drawn at full size and nothing in the menu is still moving.
 */
const menuAtRest: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  await expect
    .poll(async (): Promise<boolean> => {
      return page
        .getByRole("combobox", { name: "Search products" })
        .evaluate((search: HTMLElement): boolean => {
          const panel: Element | null = search.closest(".rounded-2xl");
          const dialog: Element | null = search.closest('[role="dialog"]');
          if (!panel || !dialog) {
            return false;
          }
          const style: CSSStyleDeclaration = getComputedStyle(panel);
          return (
            style.opacity === "1" &&
            (style.transform === "none" ||
              style.transform === "matrix(1, 0, 0, 1, 0, 0)") &&
            dialog.getAnimations({ subtree: true }).length === 0
          );
        });
    })
    .toBe(true);
};

const openMenuAt: (page: Page, path: string) => Promise<void> = async (
  page: Page,
  path: string,
): Promise<void> => {
  await page.goto(`${projectPath}${path}`);
  await expect(productsMenu(page)).toHaveCount(1);
  await expect(
    page.getByRole("combobox", { name: "Search products" }),
  ).toBeFocused();
  await menuAtRest(page);
};

test.describe("the desktop products menu", () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await openMenuAt(page, "/home");
  });

  test("opens on the essentials, with every other section folded into a row", async ({
    page,
    isMobile,
  }: {
    page: Page;
    isMobile: boolean;
  }) => {
    await expect(page.getByRole("option")).toHaveCount(ESSENTIALS.length);
    for (const [index, title] of ESSENTIALS.entries()) {
      await expect(page.getByRole("option").nth(index)).toContainText(title);
    }

    // Essentials have a row like every other section's, the first, open.
    await expect(sectionToggle(page, "Essentials")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(
      (await boxOf(sectionToggle(page, "Essentials"))).height,
    ).toBeLessThan(ONE_LINE);

    for (const section of FOLDED_SECTIONS) {
      await expect(sectionToggle(page, section)).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      /*
       * Nothing wrapped: the products are one line, and so is the name -
       * beside them from sm up. Narrower, a long name may take two lines.
       */
      expect((await boxOf(sectionToggle(page, section))).height).toBeLessThan(
        isMobile ? 2 * ONE_LINE : ONE_LINE,
      );
      expect((await boxOf(sectionProducts(page, section))).height).toBeLessThan(
        ONE_LINE,
      );
    }

    await expect(sectionLine(page, "Infrastructure")).toContainText(
      "Hosts, Kubernetes, Docker",
    );
    await expect(page.getByRole("link", { name: /^Kubernetes/ })).toHaveCount(
      0,
    );
    await expect(page.getByRole("option", { selected: true })).toContainText(
      "Monitors",
    );

    // One row per section, in the catalog's order, Essentials first.
    const toggles: Locator = productsMenu(page).locator(
      "#navbar-menu-listbox button[aria-expanded]",
    );
    await expect(toggles).toHaveCount(SECTIONS.length);
    for (const [index, section] of SECTIONS.entries()) {
      await expect(toggles.nth(index)).toHaveText(section);
    }
    // No plain heading is left above the list: every heading is a row's.
    await expect(
      productsMenu(page).locator("#navbar-menu-listbox h3"),
    ).toHaveCount(SECTIONS.length);
    await expect(
      sectionHeading(page, "Essentials").getByRole("button", {
        name: "Essentials",
        exact: true,
      }),
    ).toHaveCount(1);
  });

  test("every section is a row of one list, its columns lining every row up", async ({
    page,
    isMobile,
  }: {
    page: Page;
    isMobile: boolean;
  }) => {
    test.skip(isMobile, "From sm up a row is one line; narrower, see below.");

    const list: Locator = sectionLine(page, "Essentials").locator(
      "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' divide-y ')][1]",
    );
    await expect(list).toHaveCount(1);
    // Every section, Essentials too, is a row of that one list.
    await expect(list.locator("button[aria-expanded]")).toHaveCount(
      SECTIONS.length,
    );
    // A frame around the list, and a rule between its rows.
    await expect(list).toHaveCSS("border-top-width", "1px");
    await expect(list).toHaveCSS("border-top-left-radius", "12px");

    const rows: Array<{
      line: Box;
      icon: Box;
      name: Box;
      products: Box;
      count: Box;
    }> = [];
    for (const section of FOLDED_SECTIONS) {
      const line: Locator = sectionLine(page, section);
      rows.push({
        line: await boxOf(line),
        icon: await boxOf(line.locator("div[aria-hidden='true']").first()),
        name: await boxOf(sectionToggle(page, section)),
        products: await boxOf(sectionProducts(page, section)),
        count: await boxOf(sectionCount(page, section)),
      });
    }

    const first: (typeof rows)[number] = rows[0]!;
    for (const [index, row] of rows.entries()) {
      const section: string = FOLDED_SECTIONS[index]!;
      // Each part starts (or, for the count, ends) where the first row's does.
      expect([section, Math.round(row.icon.x)]).toEqual([
        section,
        Math.round(first.icon.x),
      ]);
      expect([section, Math.round(row.name.x)]).toEqual([
        section,
        Math.round(first.name.x),
      ]);
      expect([section, Math.round(row.products.x)]).toEqual([
        section,
        Math.round(first.products.x),
      ]);
      expect([section, Math.round(row.count.x + row.count.width)]).toEqual([
        section,
        Math.round(first.count.x + first.count.width),
      ]);
      // One line: the products sit beside the name, after it.
      expect(
        Math.abs(
          row.products.y +
            row.products.height / 2 -
            (row.name.y + row.name.height / 2),
        ),
      ).toBeLessThan(2);
      expect(row.products.x).toBeGreaterThan(row.name.x + row.name.width);
      expect(row.line.height).toBeLessThanOrEqual(48);
    }

    // The rows follow one another, a 1px rule apart.
    for (let index: number = 1; index < rows.length; index++) {
      const gap: number =
        rows[index]!.line.y -
        (rows[index - 1]!.line.y + rows[index - 1]!.line.height);
      expect(gap).toBeGreaterThanOrEqual(0);
      expect(gap).toBeLessThanOrEqual(1.5);
    }

    /*
     * The open Essentials row lists no products, and lines up its icon, its
     * name and its count with the folded rows below it.
     */
    const essentialsLine: Locator = sectionLine(page, "Essentials");
    const essentialsIcon: Box = await boxOf(
      essentialsLine.locator("div[aria-hidden='true']").first(),
    );
    const essentialsName: Box = await boxOf(sectionToggle(page, "Essentials"));
    const essentialsCount: Box = await boxOf(sectionCount(page, "Essentials"));
    await expect(sectionProducts(page, "Essentials")).toHaveCount(0);
    expect(Math.round(essentialsIcon.x)).toBe(Math.round(first.icon.x));
    expect(Math.round(essentialsName.x)).toBe(Math.round(first.name.x));
    expect(Math.round(essentialsCount.x + essentialsCount.width)).toBe(
      Math.round(first.count.x + first.count.width),
    );
    expect((await boxOf(essentialsLine)).height).toBeLessThanOrEqual(48);

    // The list spans the menu's content box: nothing sits beside it.
    const content: { x: number; width: number } = await productsMenu(page)
      .locator("#navbar-menu-listbox")
      .evaluate((element: HTMLElement): { x: number; width: number } => {
        const style: CSSStyleDeclaration = getComputedStyle(element);
        const paddingLeft: number = parseFloat(style.paddingLeft);
        return {
          x: element.getBoundingClientRect().left + paddingLeft,
          width:
            element.clientWidth - paddingLeft - parseFloat(style.paddingRight),
        };
      });
    const listBox: Box = await boxOf(list);
    expect(Math.round(listBox.x)).toBe(Math.round(content.x));
    expect(Math.round(listBox.width)).toBe(Math.round(content.width));

    // A long list of products is cut off with an ellipsis, not wrapped.
    await expect(sectionProducts(page, "Infrastructure")).toHaveCSS(
      "text-overflow",
      "ellipsis",
    );
  });

  test("in a narrow window each row puts its products under its name", async ({
    page,
    isMobile,
  }: {
    page: Page;
    isMobile: boolean;
  }) => {
    test.skip(
      !isMobile,
      "Below sm only; the Dashboard shows its phone menu there.",
    );

    // The open Essentials row's name starts where every folded row's does.
    const essentialsName: Box = await boxOf(sectionToggle(page, "Essentials"));

    for (const section of FOLDED_SECTIONS) {
      const name: Box = await boxOf(sectionToggle(page, section));
      expect([section, Math.round(name.x)]).toEqual([
        section,
        Math.round(essentialsName.x),
      ]);
      const products: Box = await boxOf(sectionProducts(page, section));
      const count: Box = await boxOf(sectionCount(page, section));

      // Under the name, starting where it starts, and one line each.
      expect(products.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
      expect(Math.round(products.x)).toBe(Math.round(name.x));
      // The products are one line; a long name may take two.
      expect(products.height).toBeLessThan(ONE_LINE);
      expect(name.height).toBeLessThan(2 * ONE_LINE);
      // The count sits beside both lines, to their right.
      expect(count.x).toBeGreaterThan(name.x + name.width);
      expect(count.y).toBeGreaterThan(name.y);
      expect(count.y + count.height).toBeLessThan(products.y + products.height);
    }
  });

  test("an opened section's products are cards inside the list, under its row", async ({
    page,
  }: {
    page: Page;
  }) => {
    await sectionToggle(page, "Resources").click();

    const list: Locator = sectionLine(page, "Resources").locator(
      "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' divide-y ')][1]",
    );
    const inventory: Locator = list.getByRole("option", {
      name: /^Inventory/,
    });
    await expect(inventory).toBeVisible();

    const row: Box = await boxOf(sectionLine(page, "Resources"));
    const card: Box = await boxOf(inventory);
    const next: Box = await boxOf(sectionLine(page, "Infrastructure"));
    expect(card.y).toBeGreaterThanOrEqual(row.y + row.height);
    expect(card.y + card.height).toBeLessThanOrEqual(next.y);
    // The open row keeps its count; its chevron turns down.
    await expect(sectionCount(page, "Resources")).toHaveText("5");
    await expect(sectionProducts(page, "Resources")).toHaveCount(0);
  });

  test("the essentials' cards are inside the list, under their row and above the first folded one", async ({
    page,
  }: {
    page: Page;
  }) => {
    const list: Locator = sectionLine(page, "Essentials").locator(
      "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' divide-y ')][1]",
    );
    const listBox: Box = await boxOf(list);
    const row: Box = await boxOf(sectionLine(page, "Essentials"));
    const next: Box = await boxOf(sectionLine(page, "Observability"));

    for (const title of ESSENTIALS) {
      const card: Locator = list.getByRole("option", {
        name: new RegExp(`^${title}`),
      });
      await expect(card).toHaveCount(1);
      const box: Box = await boxOf(card);
      expect([title, box.y >= row.y + row.height]).toEqual([title, true]);
      expect([title, box.y + box.height <= next.y]).toEqual([title, true]);
      // Inset from the list's frame on both sides.
      expect([title, box.x > listBox.x]).toEqual([title, true]);
      expect([title, box.x + box.width < listBox.x + listBox.width]).toEqual([
        title,
        true,
      ]);
    }
    await expect(sectionCount(page, "Essentials")).toHaveText("7");
  });

  test("a click anywhere on a folded line opens it, and focus stays in the search box", async ({
    page,
  }: {
    page: Page;
  }) => {
    /*
     * Click the list of products at the right of the line, not the name. On
     * a short screen the line is below the fold of the menu's own scroll
     * area, so bring it into view first.
     */
    const names: Locator = sectionLine(page, "Infrastructure").getByText(
      /^Hosts, Kubernetes, Docker/,
    );
    await names.scrollIntoViewIfNeeded();
    const box: { x: number; y: number; width: number; height: number } | null =
      await names.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

    await expect(sectionToggle(page, "Infrastructure")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(
      page.getByRole("link", { name: /^Kubernetes/ }),
    ).toBeInViewport();
    await expect(page.getByRole("combobox")).toBeFocused();

    // A second click folds it again.
    await sectionToggle(page, "Infrastructure").click();
    await expect(page.getByRole("link", { name: /^Kubernetes/ })).toHaveCount(
      0,
    );
  });

  test("the keyboard reaches a folded section, opens it with Enter and moves into it", async ({
    page,
  }: {
    page: Page;
  }) => {
    const search: Locator = page.getByRole("combobox");
    const observability: Locator = sectionToggle(page, "Observability");

    const observabilityId: string = (await observability.getAttribute("id"))!;
    const essentialsId: string = (await sectionToggle(
      page,
      "Essentials",
    ).getAttribute("id"))!;

    // Up from Monitors is the Essentials row, and Down comes back.
    await expect(page.getByRole("option", { selected: true })).toContainText(
      "Monitors",
    );
    await search.press("ArrowUp");
    await expect(search).toHaveAttribute("aria-activedescendant", essentialsId);
    await search.press("ArrowDown");
    await expect(page.getByRole("option", { selected: true })).toContainText(
      "Monitors",
    );

    /*
     * Down walks the rows of Essentials (three across on a desktop, one on a
     * phone), and from the last of them lands on the first folded line.
     */
    for (let step: number = 0; step < ESSENTIALS.length; step++) {
      if (
        (await search.getAttribute("aria-activedescendant")) === observabilityId
      ) {
        break;
      }
      await search.press("ArrowDown");
    }
    await expect(search).toHaveAttribute(
      "aria-activedescendant",
      observabilityId,
    );

    // Up goes back to the last row of Essentials.
    await search.press("ArrowUp");
    await expect(page.getByRole("option", { selected: true })).toContainText(
      "SLOs",
    );
    await search.press("ArrowDown");
    await expect(search).toHaveAttribute(
      "aria-activedescendant",
      observabilityId,
    );

    await search.press("Enter");
    await expect(observability).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(search).toHaveAttribute(
      "aria-activedescendant",
      observabilityId,
    );

    // Down from a heading lands on the first product under it.
    await search.press("ArrowDown");
    await expect(page.getByRole("option", { selected: true })).toContainText(
      "Logs",
    );
    await expect(page.getByRole("option", { selected: true })).toBeInViewport();

    await search.press("Enter");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(`${projectPath}/logs`);
  });

  test("search finds a product in a folded section, and clearing it folds the menu again", async ({
    page,
  }: {
    page: Page;
  }) => {
    const search: Locator = page.getByRole("combobox");

    await search.fill("vsphere");
    await expect(page.getByRole("option")).toHaveCount(1);
    await expect(page.getByRole("option")).toContainText("VMware");
    await expect(
      productsMenu(page).locator("button[aria-expanded]"),
    ).toHaveCount(0);

    await search.press("Enter");
    await expect(page).toHaveURL(`${projectPath}/vmware`);
  });

  test("a section opened or folded is remembered after a reload", async ({
    page,
  }: {
    page: Page;
  }) => {
    await sectionToggle(page, "Code").click();
    await sectionToggle(page, "Settings").click();
    await sectionToggle(page, "Settings").click();
    await expect(page.getByRole("option")).toHaveCount(ESSENTIALS.length + 1);

    await openMenuAt(page, "/home");

    await expect(sectionToggle(page, "Code")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(sectionToggle(page, "Settings")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(page.getByRole("option")).toHaveCount(ESSENTIALS.length + 1);
    await expect(page.getByRole("option").last()).toContainText("Tasks");
  });

  test("the essentials fold for the moment, and are open again on the next visit", async ({
    page,
  }: {
    page: Page;
  }) => {
    const essentials: Locator = sectionToggle(page, "Essentials");

    await essentials.click();

    await expect(essentials).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("option")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(page.getByRole("combobox")).toBeFocused();
    // Folded, their row says what they hold, as every folded row does.
    await expect(sectionProducts(page, "Essentials")).toContainText(
      "Monitors, Incidents, Alerts",
    );
    expect(
      (await boxOf(sectionProducts(page, "Essentials"))).height,
    ).toBeLessThan(ONE_LINE);

    // A second click opens them again.
    await essentials.click();
    await expect(page.getByRole("option")).toHaveCount(ESSENTIALS.length);

    // Folded again, then a reload: they are open, and nothing was stored.
    await essentials.click();
    await expect(page.getByRole("option")).toHaveCount(0);
    await openMenuAt(page, "/home");

    await expect(sectionToggle(page, "Essentials")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(page.getByRole("option")).toHaveCount(ESSENTIALS.length);
    expect(
      await page.evaluate((key: string): string | null => {
        return window.localStorage.getItem(key);
      }, FOLDS_STORAGE_KEY),
    ).toBeNull();
  });

  test("Enter on the essentials' row folds them, and opens them again", async ({
    page,
  }: {
    page: Page;
  }) => {
    const search: Locator = page.getByRole("combobox");
    const essentials: Locator = sectionToggle(page, "Essentials");

    // Left from Monitors, the first product, is the Essentials row.
    await search.press("ArrowLeft");
    await expect(search).toHaveAttribute(
      "aria-activedescendant",
      (await essentials.getAttribute("id"))!,
    );

    await search.press("Enter");
    await expect(essentials).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("option")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(1);

    await search.press("Enter");
    await expect(essentials).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("option")).toHaveCount(ESSENTIALS.length);
    await search.press("ArrowRight");
    await expect(page.getByRole("option", { selected: true })).toContainText(
      "Monitors",
    );
  });

  test("the essentials are open on every visit, even where a fold of them was remembered", async ({
    page,
  }: {
    page: Page;
  }) => {
    // What the menu stored when a fold of Essentials was remembered.
    await page.evaluate((key: string) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({ Essentials: false, Code: true }),
      );
    }, FOLDS_STORAGE_KEY);

    await openMenuAt(page, "/home");

    await expect(page.getByRole("option")).toHaveCount(ESSENTIALS.length + 1);
    for (const [index, title] of ESSENTIALS.entries()) {
      await expect(page.getByRole("option").nth(index)).toContainText(title);
    }
    await expect(sectionToggle(page, "Essentials")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(sectionToggle(page, "Code")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(page.getByRole("option", { selected: true })).toContainText(
      "Monitors",
    );
  });
});

test("the section of the current page opens by itself, with its product selected", async ({
  page,
}: {
  page: Page;
}) => {
  await openMenuAt(page, "/kubernetes");

  await expect(sectionToggle(page, "Infrastructure")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  // The essentials are open beside it.
  await expect(sectionToggle(page, "Essentials")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  const selected: Locator = page.getByRole("option", { selected: true });
  await expect(selected).toContainText("Kubernetes");
  await expect(selected).toBeInViewport();
  for (const section of FOLDED_SECTIONS) {
    if (section !== "Infrastructure") {
      await expect(sectionToggle(page, section)).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    }
  }
});

test("on a phone, the menu toggle lists the essentials and folds the other sections", async ({
  page,
  isMobile,
}: {
  page: Page;
  isMobile: boolean;
}) => {
  test.skip(!isMobile, "The phone menu exists below 768px only.");

  await page.goto(`${projectPath}/home?navbar=true`);
  const navbar: Locator = page.getByTestId("dashboard-navbar");
  await navbar.getByTestId("mobile-nav-toggle").click();

  for (const title of ESSENTIALS) {
    await expect(navLink(navbar, title)).toBeVisible();
  }
  await expect(navLink(navbar, "Kubernetes")).toHaveCount(0);
  // Essentials are a row like every other section's, open.
  const essentials: Locator = navbar.getByRole("button", {
    name: "Essentials",
    exact: true,
  });
  await expect(essentials).toHaveAttribute("aria-expanded", "true");

  const infrastructure: Locator = navbar.getByRole("button", {
    name: "Infrastructure",
    exact: true,
  });
  await expect(infrastructure).toHaveAttribute("aria-expanded", "false");

  /*
   * A section's row is drawn as the top-level rows are: its icon before its
   * name, where Home's is, with what a folded one holds on a second line
   * under the name.
   */
  const homeIcon: Box = await boxOf(navLink(navbar, "Home").locator("svg"));
  const sectionIcon: (name: string) => Promise<Box> = async (
    name: string,
  ): Promise<Box> => {
    return boxOf(
      navbar.getByRole("heading", { name, exact: true }).locator("svg"),
    );
  };
  const infrastructureIcon: Box = await sectionIcon("Infrastructure");
  const essentialsIcon: Box = await sectionIcon("Essentials");
  const name: Box = await boxOf(infrastructure);
  const products: Box = await boxOf(
    navbar.getByText(/^Hosts, Kubernetes, Docker/),
  );
  expect(Math.round(infrastructureIcon.x)).toBe(Math.round(homeIcon.x));
  expect(Math.round(essentialsIcon.x)).toBe(Math.round(homeIcon.x));
  expect(infrastructureIcon.x).toBeLessThan(name.x);
  expect(products.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
  expect(Math.round(products.x)).toBe(Math.round(name.x));

  // The essentials' products are indented under their row.
  const monitorsIcon: Box = await boxOf(
    navLink(navbar, "Monitors").locator("svg"),
  );
  expect(monitorsIcon.x).toBeGreaterThan(essentialsIcon.x + 8);

  // One rule sets the sections apart from Home above them.
  await expect(
    navbar.getByRole("group", { name: "Essentials", exact: true }),
  ).toHaveCSS("border-top-width", "1px");
  await expect(
    navbar.getByRole("group", { name: "Observability", exact: true }),
  ).toHaveCSS("border-top-width", "0px");

  // A tap folds the essentials, and the menu stays open; another opens them.
  await essentials.click();
  await expect(essentials).toHaveAttribute("aria-expanded", "false");
  await expect(navLink(navbar, "Monitors")).toHaveCount(0);
  await expect(navLink(navbar, "Home")).toBeVisible();
  await essentials.click();
  await expect(navLink(navbar, "Monitors")).toBeVisible();

  await infrastructure.click();

  // The menu stays open, with the section's products under it, indented.
  const kubernetes: Locator = navLink(navbar, "Kubernetes");
  await expect(kubernetes).toBeVisible();
  expect(Math.round((await boxOf(kubernetes.locator("svg"))).x)).toBe(
    Math.round(monitorsIcon.x),
  );
  await kubernetes.click();

  await expect(page).toHaveURL(`${projectPath}/kubernetes`);
  await expect(
    navbar.getByRole("button", { name: "Kubernetes", exact: true }),
  ).toBeVisible();
});
