import { expect, Locator, Page, test } from "@playwright/test";

/*
 * The products menu opens on the essentials instead of every product.
 *
 * The Dashboard's menu always opens on its seven Essentials, which never
 * fold: a plain heading, with no chevron, and no remembered fold hides them.
 * Every other section is folded into a row of one list below them: its
 * icon, its name, what its products are called, how many and a chevron. A
 * click anywhere on the row, or Enter on it, opens it; search ignores
 * folding; the section of the page the user is on opens by itself; and what
 * someone opens or folds among those sections is remembered on their
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

const productsMenu: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByRole("dialog", { name: "Products menu" });
};

const sectionToggle: (page: Page, name: string) => Locator = (
  page: Page,
  name: string,
): Locator => {
  return productsMenu(page).getByRole("button", { name, exact: true });
};

// The heading of a section, whether it folds (a button inside) or not.
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

const openMenuAt: (page: Page, path: string) => Promise<void> = async (
  page: Page,
  path: string,
): Promise<void> => {
  await page.goto(`${projectPath}${path}`);
  await expect(productsMenu(page)).toHaveCount(1);
  await expect(
    page.getByRole("combobox", { name: "Search products" }),
  ).toBeFocused();
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

    // Essentials have a plain heading: nothing on screen folds them.
    await expect(sectionHeading(page, "Essentials")).toBeVisible();
    await expect(sectionToggle(page, "Essentials")).toHaveCount(0);
    await expect(
      productsMenu(page).locator("#navbar-menu-listbox button[aria-expanded]"),
    ).toHaveCount(FOLDED_SECTIONS.length);
  });

  test("the folded sections are the rows of one list, its columns lining every row up", async ({
    page,
    isMobile,
  }: {
    page: Page;
    isMobile: boolean;
  }) => {
    test.skip(isMobile, "From sm up a row is one line; narrower, see below.");

    const list: Locator = sectionLine(page, FOLDED_SECTIONS[0]!).locator(
      "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' divide-y ')][1]",
    );
    await expect(list).toHaveCount(1);
    // Every folded section is a row of that one list.
    await expect(list.locator("button[aria-expanded]")).toHaveCount(
      FOLDED_SECTIONS.length,
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

    // The list is as wide as the cards above it.
    const essentials: Box = await boxOf(
      productsMenu(page).getByRole("group", { name: "Essentials" }),
    );
    const listBox: Box = await boxOf(list);
    expect(Math.round(listBox.x)).toBe(Math.round(essentials.x));
    expect(Math.round(listBox.width)).toBe(Math.round(essentials.width));

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

    for (const section of FOLDED_SECTIONS) {
      const name: Box = await boxOf(sectionToggle(page, section));
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

  test("the essentials are open on every visit, even where a fold of them was remembered", async ({
    page,
  }: {
    page: Page;
  }) => {
    // What the menu stored when Essentials could still be folded.
    await page.evaluate(() => {
      window.localStorage.setItem(
        "oneuptime-navbar-product-categories",
        JSON.stringify({ Essentials: false, Code: true }),
      );
    });

    await openMenuAt(page, "/home");

    await expect(page.getByRole("option")).toHaveCount(ESSENTIALS.length + 1);
    for (const [index, title] of ESSENTIALS.entries()) {
      await expect(page.getByRole("option").nth(index)).toContainText(title);
    }
    await expect(sectionToggle(page, "Code")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(page.getByRole("option", { selected: true })).toContainText(
      "Monitors",
    );

    // A click on their heading changes nothing.
    await sectionHeading(page, "Essentials").click();
    await expect(page.getByRole("option")).toHaveCount(ESSENTIALS.length + 1);
    await expect(page.getByRole("dialog")).toHaveCount(1);
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
  // Essentials sit under a plain heading that never folds.
  await expect(
    navbar.getByRole("heading", { name: "Essentials", exact: true }),
  ).toBeVisible();
  await expect(
    navbar.getByRole("button", { name: "Essentials", exact: true }),
  ).toHaveCount(0);

  const infrastructure: Locator = navbar.getByRole("button", {
    name: "Infrastructure",
    exact: true,
  });
  await expect(infrastructure).toHaveAttribute("aria-expanded", "false");

  /*
   * A folded section's row is drawn as the product rows are: its icon
   * before its name, at the same place, with what it holds on a second line
   * under the name.
   */
  const productIcon: Box = await boxOf(
    navLink(navbar, "Monitors").locator("svg"),
  );
  const heading: Locator = navbar.getByRole("heading", {
    name: "Infrastructure",
    exact: true,
  });
  const sectionIcon: Box = await boxOf(heading.locator("svg"));
  const name: Box = await boxOf(infrastructure);
  const products: Box = await boxOf(
    navbar.getByText(/^Hosts, Kubernetes, Docker/),
  );
  expect(Math.round(sectionIcon.x)).toBe(Math.round(productIcon.x));
  expect(sectionIcon.x).toBeLessThan(name.x);
  expect(products.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
  expect(Math.round(products.x)).toBe(Math.round(name.x));

  // A rule sets the folded sections apart from the essentials above them.
  await expect(
    navbar.getByRole("group", { name: "Observability", exact: true }),
  ).toHaveCSS("border-top-width", "1px");

  await infrastructure.click();

  // The menu stays open, with the section's products under it, indented.
  const kubernetes: Locator = navLink(navbar, "Kubernetes");
  await expect(kubernetes).toBeVisible();
  expect((await boxOf(kubernetes.locator("svg"))).x).toBeGreaterThan(
    sectionIcon.x + 8,
  );
  await kubernetes.click();

  await expect(page).toHaveURL(`${projectPath}/kubernetes`);
  await expect(
    navbar.getByRole("button", { name: "Kubernetes", exact: true }),
  ).toBeVisible();
});
