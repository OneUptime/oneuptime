import { expect, Locator, Page, test } from "@playwright/test";

/*
 * The products menu opens on the essentials instead of every product.
 *
 * The Dashboard's menu opens on its seven Essentials. Every other section is
 * folded to one line: its name, how many products it holds and what they are
 * called. A click anywhere on the line, or Enter on it, opens it; search
 * ignores folding; the section of the page the user is on opens by itself;
 * and what someone opens or folds is remembered on their browser. On a phone
 * the menu toggle lists the products the same way.
 *
 * These run the production menu and catalog in a real browser, where layout
 * is real: a folded line is one line, a click on its list of products hits
 * the line's button, and the arrow keys move by where rows are drawn.
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

// The whole line of a section: the row its heading button sits in.
const sectionLine: (page: Page, name: string) => Locator = (
  page: Page,
  name: string,
): Locator => {
  return sectionToggle(page, name).locator(
    "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' relative ')][1]",
  );
};

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

  test("opens on the essentials, with every other section folded to one line", async ({
    page,
  }: {
    page: Page;
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
      const box: { height: number } | null = await sectionLine(
        page,
        section,
      ).boundingBox();
      expect(box).not.toBeNull();
      // One line of text plus the row's padding: nothing wrapped.
      expect(box!.height).toBeLessThan(48);
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
    await sectionToggle(page, "Essentials").click();
    await expect(page.getByRole("option")).toHaveCount(1);

    await openMenuAt(page, "/home");

    await expect(sectionToggle(page, "Code")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(sectionToggle(page, "Essentials")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(page.getByRole("option")).toHaveCount(1);
    await expect(page.getByRole("option")).toContainText("Tasks");
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

  const infrastructure: Locator = navbar.getByRole("button", {
    name: "Infrastructure",
    exact: true,
  });
  await expect(infrastructure).toHaveAttribute("aria-expanded", "false");
  await infrastructure.click();

  // The menu stays open, with the section's products under it.
  const kubernetes: Locator = navLink(navbar, "Kubernetes");
  await expect(kubernetes).toBeVisible();
  await kubernetes.click();

  await expect(page).toHaveURL(`${projectPath}/kubernetes`);
  await expect(
    navbar.getByRole("button", { name: "Kubernetes", exact: true }),
  ).toBeVisible();
});
