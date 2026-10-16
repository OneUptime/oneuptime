import { ConsoleMessage, expect, Locator, Page, test } from "@playwright/test";
import path from "path";

/*
 * The products menu's "Recently visited" row shows six products.
 *
 * The maintainer passed on a customer's suggestion with a screenshot of
 * the row: Teams, Project Settings and Users on one row, and Alerts alone
 * under it. "Suggestion to expand this list to 6, since you have the
 * real-estate and 4 items shown now take up 2 rows anyway." The row kept
 * five products at most and left out the page the user was on, so it
 * usually drew four. It now draws six: two full rows of three cards on a
 * desktop, three rows of two from 768px (where the dialog first opens) to
 * 1023px. The browser remembers twenty, so the row still fills on the page
 * of one of them, and after work in another project.
 *
 * The menu opens at the top, with the cursor on the row's first card (the
 * product used before this one, which Enter opens). It used to open on
 * the current page's product and scroll the list to it, which hid the row
 * on every page low in the list (Teams, Logs, Kubernetes). The card of the
 * page the user is on now shows beside the cursor's whenever it is on
 * screen, so it stays fainter than the cursor's in the dark theme too.
 *
 * These run the production menu and Dashboard catalog in a real browser,
 * where the rows are laid out for real. A phone gets the menu toggle's list
 * instead of this dialog (ProductsMenuFolding.spec.ts), so they run on the
 * desktop project only.
 */

const projectPath: string = "/dashboard/00000000-0000-4000-8000-000000000001";
const otherProjectPath: string =
  "/dashboard/00000000-0000-4000-8000-000000000002";

// Where the menu remembers the products someone opened from it.
const RECENT_STORAGE_KEY: string = "oneuptime-navbar-recent-products";

// The stylesheet that re-colours the light classes under html.dark.
const THEME_CSS_PATH: string = path.resolve(
  __dirname,
  "..",
  "..",
  "Common",
  "UI",
  "Styles",
  "Theme.css",
);

interface Rgba {
  rgb: string;
  alpha: number;
}

interface CardColors {
  background: Rgba;
  border: Rgba;
}

// A computed colour, "rgb(1, 2, 3)" or "rgba(1, 2, 3, 0.4)", as its parts.
const rgbaOf: (color: string) => Rgba = (color: string): Rgba => {
  const parts: Array<string> = color
    .slice(color.indexOf("(") + 1, color.lastIndexOf(")"))
    .split(",")
    .map((part: string): string => {
      return part.trim();
    });
  expect(parts.length === 3 || parts.length === 4).toBe(true);
  return {
    rgb: parts.slice(0, 3).join(", "),
    alpha: parts.length === 4 ? Number(parts[3]) : 1,
  };
};

const colorsOf: (card: Locator) => Promise<CardColors> = async (
  card: Locator,
): Promise<CardColors> => {
  const [background, border]: Array<string> = await card.evaluate(
    (element: Element): Array<string> => {
      const style: CSSStyleDeclaration = getComputedStyle(element);
      return [style.backgroundColor, style.borderTopColor];
    },
  );
  return { background: rgbaOf(background!), border: rgbaOf(border!) };
};

interface Product {
  title: string;
  path: string;
}

// Products of the Dashboard catalog, by their English names and addresses.
const TEAMS: Product = { title: "Teams", path: "teams" };
const USERS: Product = { title: "Users", path: "users" };
const ALERTS: Product = { title: "Alerts", path: "alerts" };
const MONITORS: Product = { title: "Monitors", path: "monitors" };
const INCIDENTS: Product = { title: "Incidents", path: "incidents" };
const LOGS: Product = { title: "Logs", path: "logs" };
const TRACES: Product = { title: "Traces", path: "traces" };
const STATUS_PAGES: Product = { title: "Status Pages", path: "status-pages" };

// Seven products, the newest first.
const SEVEN: Array<Product> = [
  TEAMS,
  USERS,
  ALERTS,
  MONITORS,
  INCIDENTS,
  LOGS,
  TRACES,
];

const routeOf: (product: Product) => string = (product: Product): string => {
  return `${projectPath}/${product.path}`;
};

const titlesOf: (products: Array<Product>) => Array<string> = (
  products: Array<Product>,
): Array<string> => {
  return products.map((product: Product): string => {
    return product.title;
  });
};

const productsMenu: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByRole("dialog", { name: "Products menu" });
};

const recentRow: (page: Page, name?: string) => Locator = (
  page: Page,
  name: string = "Recent",
): Locator => {
  return productsMenu(page).getByRole("group", { name, exact: true });
};

const recentCards: (page: Page, name?: string) => Locator = (
  page: Page,
  name?: string,
): Locator => {
  return recentRow(page, name).getByRole("option");
};

const recentTitles: (
  page: Page,
  name?: string,
) => Promise<Array<string>> = async (
  page: Page,
  name?: string,
): Promise<Array<string>> => {
  return recentCards(page, name).evaluateAll(
    (options: Array<Element>): Array<string> => {
      return options.map((option: Element): string => {
        return option.querySelector("span.truncate")?.textContent ?? "";
      });
    },
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

/*
 * The menu opens with a short zoom and fade (NavBarMenuModal). A box read
 * while it plays is scaled, so measure only once the panel is drawn at full
 * size and nothing in the menu is still moving.
 */
const menuAtRest: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  await expect
    .poll(async (): Promise<boolean> => {
      return productsMenu(page)
        .getByRole("combobox")
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

// Store a list of addresses the way the menu stores them, then load a page.
const rememberAndOpen: (
  page: Page,
  routes: Array<string>,
  path?: string,
) => Promise<void> = async (
  page: Page,
  routes: Array<string>,
  path: string = "/home",
): Promise<void> => {
  await page.goto(`${projectPath}/home`);
  await page.evaluate(
    ([key, value]: [string, string]): void => {
      window.localStorage.setItem(key, value);
    },
    [RECENT_STORAGE_KEY, JSON.stringify(routes)] as [string, string],
  );
  await page.goto(`${projectPath}${path}`);
  await expect(productsMenu(page)).toHaveCount(1);
  await menuAtRest(page);
};

const storedRoutes: (page: Page) => Promise<Array<string>> = async (
  page: Page,
): Promise<Array<string>> => {
  return page.evaluate((key: string): Array<string> => {
    return JSON.parse(window.localStorage.getItem(key) ?? "[]");
  }, RECENT_STORAGE_KEY);
};

// Open a product the way someone does: type its name, click its card.
const openFromMenu: (page: Page, product: Product) => Promise<void> = async (
  page: Page,
  product: Product,
): Promise<void> => {
  if ((await productsMenu(page).count()) === 0) {
    await page.getByRole("button", { name: "Open products" }).click();
  }
  await expect(productsMenu(page)).toHaveCount(1);
  await productsMenu(page).getByRole("combobox").fill(product.title);
  await productsMenu(page)
    .locator(`a[href="${routeOf(product)}"]`)
    .click();
  await expect(productsMenu(page)).toHaveCount(0);
  await expect(page.getByTestId("current-route")).toHaveText(routeOf(product));
};

/*
 * The cards of the row, grouped into the rows they are drawn on (by their
 * top edge), each row from left to right.
 */
const cardRows: (cards: Locator) => Promise<Array<Array<Box>>> = async (
  cards: Locator,
): Promise<Array<Array<Box>>> => {
  const boxes: Array<Box> = [];
  for (let index: number = 0; index < (await cards.count()); index++) {
    boxes.push(await boxOf(cards.nth(index)));
  }
  const rows: Array<Array<Box>> = [];
  for (const box of boxes) {
    const row: Array<Box> | undefined = rows.find(
      (candidate: Array<Box>): boolean => {
        return Math.abs(candidate[0]!.y - box.y) <= 1;
      },
    );
    if (row) {
      row.push(box);
    } else {
      rows.push([box]);
    }
  }
  return rows;
};

const expectColumnsLinedUp: (rows: Array<Array<Box>>) => void = (
  rows: Array<Array<Box>>,
): void => {
  for (const row of rows.slice(1)) {
    row.forEach((box: Box, column: number): void => {
      expect(Math.abs(box.x - rows[0]![column]!.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.width - rows[0]![column]!.width)).toBeLessThanOrEqual(
        1,
      );
    });
  }
};

test.describe("the Recently visited row of the products menu", () => {
  test.skip(({ isMobile }: { isMobile: boolean }): boolean => {
    return isMobile;
  }, "The products dialog opens from 768px up; a phone gets the menu toggle's list.");

  test("seven products opened one after another: on the seventh's page, the six before it fill two rows of three", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${projectPath}/home`);
    await expect(productsMenu(page)).toHaveCount(1);

    const opened: Array<Product> = [...SEVEN].reverse();
    for (const product of opened) {
      await openFromMenu(page, product);
    }

    // On Teams, the last one opened.
    await page.getByRole("button", { name: "Open products" }).click();
    await menuAtRest(page);

    await expect(recentCards(page)).toHaveCount(6);
    expect(await recentTitles(page)).toEqual(titlesOf(SEVEN.slice(1)));
    expect(await storedRoutes(page)).toEqual(SEVEN.map(routeOf));

    // Two full rows of three, the columns lined up.
    const rows: Array<Array<Box>> = await cardRows(recentCards(page));
    expect(
      rows.map((row: Array<Box>): number => {
        return row.length;
      }),
    ).toEqual([3, 3]);
    expectColumnsLinedUp(rows);
    expect(rows[1]![0]!.y).toBeGreaterThan(rows[0]![0]!.y);
    // The row sits above the Essentials, the menu's first section.
    const essentials: Box = await boxOf(
      productsMenu(page).getByRole("heading", {
        name: "Essentials",
        exact: true,
      }),
    );
    expect(essentials.y).toBeGreaterThan(rows[1]![0]!.y);
  });

  test("on Home, with seven remembered, the newest six are shown and the seventh is not", async ({
    page,
  }: {
    page: Page;
  }) => {
    await rememberAndOpen(page, [...SEVEN, STATUS_PAGES].map(routeOf));

    await expect(recentCards(page)).toHaveCount(6);
    expect(await recentTitles(page)).toEqual(titlesOf(SEVEN.slice(0, 6)));
    await expect(
      recentRow(page).getByRole("link", { name: /^Traces/ }),
    ).toHaveCount(0);
  });

  test("on a page low in the menu, it opens at the top: the row in view and the cursor on its first card, which Enter opens", async ({
    page,
  }: {
    page: Page;
  }) => {
    // Teams sits in Settings, the last section of the list.
    await rememberAndOpen(page, SEVEN.map(routeOf), "/teams");
    /*
     * Open it again: by now the page has drawn every class the menu uses,
     * as a page in use has, so the list scrolls as it does for real.
     */
    await productsMenu(page).getByRole("combobox").press("Escape");
    await expect(productsMenu(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Open products" }).click();
    await menuAtRest(page);

    await expect(
      productsMenu(page).getByRole("heading", { name: "Recent", exact: true }),
    ).toBeInViewport();
    await expect(recentCards(page)).toHaveCount(6);
    for (let index: number = 0; index < 6; index++) {
      await expect(recentCards(page).nth(index)).toBeInViewport();
    }
    expect(await recentTitles(page)).toEqual(titlesOf(SEVEN.slice(1)));
    expect(
      await productsMenu(page)
        .locator("#navbar-menu-listbox")
        .evaluate((list: Element): number => {
          return list.scrollTop;
        }),
    ).toBe(0);

    // The cursor is on the product used before this one.
    await expect(
      recentRow(page).getByRole("option", { selected: true }),
    ).toContainText(USERS.title);

    // Teams is still marked where it is: its section opened by itself.
    await expect(
      productsMenu(page).getByRole("button", { name: "Settings", exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
    await expect(
      productsMenu(page).locator(`a[href="${routeOf(TEAMS)}"]`),
    ).toHaveCount(1);

    // Enter goes back to it.
    await productsMenu(page).getByRole("combobox").press("Enter");
    await expect(productsMenu(page)).toHaveCount(0);
    await expect(page.getByTestId("current-route")).toHaveText(routeOf(USERS));
    expect((await storedRoutes(page))[0]).toBe(routeOf(USERS));
  });

  test("on an Essentials product's page, its card is fainter than the cursor's, in the dark theme as in the light", async ({
    page,
  }: {
    page: Page;
  }) => {
    // Monitors is in the Essentials, on screen beside the Recently visited row.
    await rememberAndOpen(page, SEVEN.map(routeOf), "/monitors");
    // The Dashboard's stylesheet, which re-colours the classes for dark.
    await page.addStyleTag({ path: THEME_CSS_PATH });
    await page.addStyleTag({
      content: "*, *::before, *::after { transition: none !important; }",
    });

    const cursorLink: Locator = recentRow(page)
      .getByRole("option", { selected: true })
      .getByRole("link");
    const currentLink: Locator = productsMenu(page).locator(
      '[role="option"][aria-current="page"] > a',
    );
    await expect(cursorLink).toHaveAttribute("href", routeOf(TEAMS));
    await expect(currentLink).toHaveCount(1);
    await expect(currentLink).toHaveAttribute("href", routeOf(MONITORS));

    for (const theme of ["light", "dark"]) {
      await page.evaluate((isDark: boolean): void => {
        document.documentElement.classList.toggle("dark", isDark);
      }, theme === "dark");

      const cursor: CardColors = await colorsOf(cursorLink);
      const current: CardColors = await colorsOf(currentLink);

      // The same hue, at well under half the wash of the card Enter opens.
      expect(current.background.rgb, `${theme} hue`).toBe(
        cursor.background.rgb,
      );
      expect(current.background.alpha, `${theme} wash`).toBeGreaterThan(0);
      expect(current.background.alpha, `${theme} wash`).toBeLessThanOrEqual(
        cursor.background.alpha / 2,
      );
    }

    // Dark: its edge is fainter than the cursor's too.
    const cursorEdge: CardColors = await colorsOf(cursorLink);
    const currentEdge: CardColors = await colorsOf(currentLink);
    expect(currentEdge.border.alpha).toBeGreaterThan(0);
    expect(currentEdge.border.alpha).toBeLessThanOrEqual(
      cursorEdge.border.alpha / 2,
    );
  });

  test("from 768 to 1023 pixels wide, the six cards are three rows of two", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await rememberAndOpen(page, SEVEN.map(routeOf));

    await expect(recentCards(page)).toHaveCount(6);
    const rows: Array<Array<Box>> = await cardRows(recentCards(page));
    expect(
      rows.map((row: Array<Box>): number => {
        return row.length;
      }),
    ).toEqual([2, 2, 2]);
    expectColumnsLinedUp(rows);
  });

  test("the arrow keys move between the two rows, and on to the Essentials", async ({
    page,
  }: {
    page: Page;
  }) => {
    await rememberAndOpen(page, SEVEN.map(routeOf));
    const search: Locator = productsMenu(page).getByRole("combobox");
    const selected: Locator = productsMenu(page).getByRole("option", {
      selected: true,
    });

    // The cursor starts on the newest card.
    await expect(selected).toContainText("Teams");

    // Down from the first card is the fourth, under it.
    await search.press("ArrowDown");
    await expect(selected).toContainText("Monitors");

    // Right from the third card is the fourth, as when reading.
    await search.press("ArrowUp");
    await search.press("ArrowRight");
    await search.press("ArrowRight");
    await expect(selected).toContainText("Alerts");
    await search.press("ArrowRight");
    await expect(selected).toContainText("Monitors");

    // Down from the second row leaves the row for the Essentials' row.
    await search.press("ArrowDown");
    const essentialsId: string | null = await productsMenu(page)
      .getByRole("button", { name: "Essentials", exact: true })
      .getAttribute("id");
    expect(essentialsId).not.toBeNull();
    await expect(search).toHaveAttribute(
      "aria-activedescendant",
      essentialsId!,
    );

    // Back up into the row, and Enter opens the card the cursor is on.
    await search.press("ArrowUp");
    await expect(selected).toContainText("Monitors");
    await search.press("ArrowRight");
    await search.press("ArrowRight");
    await expect(selected).toContainText("Logs");
    await search.press("Enter");

    await expect(productsMenu(page)).toHaveCount(0);
    await expect(page.getByTestId("current-route")).toHaveText(routeOf(LOGS));
    expect((await storedRoutes(page))[0]).toBe(routeOf(LOGS));
  });

  test("a list remembered before the row grew still shows, and grows past five", async ({
    page,
  }: {
    page: Page;
  }) => {
    const old: Array<Product> = SEVEN.slice(0, 5);
    await rememberAndOpen(page, old.map(routeOf));

    expect(await recentTitles(page)).toEqual(titlesOf(old));

    await openFromMenu(page, STATUS_PAGES);

    expect(await storedRoutes(page)).toEqual(
      [STATUS_PAGES, ...old].map(routeOf),
    );

    // Back on Home, all six are in the row.
    await page.goto(`${projectPath}/home`);
    await menuAtRest(page);
    expect(await recentTitles(page)).toEqual(titlesOf([STATUS_PAGES, ...old]));
  });

  test("another project's products remembered in between are skipped, and the row still fills", async ({
    page,
  }: {
    page: Page;
  }) => {
    const remembered: Array<string> = [
      routeOf(TEAMS),
      `${otherProjectPath}/monitors`,
      routeOf(USERS),
      "/admin/users",
      routeOf(ALERTS),
      `${otherProjectPath}/logs`,
      routeOf(MONITORS),
      `${otherProjectPath}/alerts`,
      routeOf(INCIDENTS),
      "/admin/settings",
      routeOf(LOGS),
    ];
    await rememberAndOpen(page, remembered);

    expect(await recentTitles(page)).toEqual(titlesOf(SEVEN.slice(0, 6)));
    const hrefs: Array<string | null> = await recentRow(page)
      .getByRole("link")
      .evaluateAll((links: Array<Element>): Array<string | null> => {
        return links.map((link: Element): string | null => {
          return link.getAttribute("href");
        });
      });
    expect(hrefs).toEqual(SEVEN.slice(0, 6).map(routeOf));
  });

  test("the browser keeps twenty products at most", async ({
    page,
  }: {
    page: Page;
  }) => {
    const twenty: Array<string> = Array.from(
      { length: 20 },
      (_: unknown, index: number): string => {
        return `${otherProjectPath}/product-${index}`;
      },
    );
    await rememberAndOpen(page, twenty);
    await expect(recentRow(page)).toHaveCount(0);

    await openFromMenu(page, ALERTS);

    expect(await storedRoutes(page)).toEqual([
      routeOf(ALERTS),
      ...twenty.slice(0, 19),
    ]);
  });

  test("in the Dashboard's own navbar, the row is called Recently visited", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${projectPath}/home?navbar=true`);
    await page.evaluate(
      ([key, value]: [string, string]): void => {
        window.localStorage.setItem(key, value);
      },
      [RECENT_STORAGE_KEY, JSON.stringify(SEVEN.map(routeOf))] as [
        string,
        string,
      ],
    );
    await page.goto(`${projectPath}/home?navbar=true`);

    await page
      .getByTestId("dashboard-navbar")
      .getByRole("button", { name: "Products", exact: true })
      .click();
    await menuAtRest(page);

    await expect(
      productsMenu(page).getByRole("heading", {
        name: "Recently visited",
        exact: true,
      }),
    ).toBeVisible();
    await expect(recentCards(page, "Recently visited")).toHaveCount(6);
    expect(await recentTitles(page, "Recently visited")).toEqual(
      titlesOf(SEVEN.slice(0, 6)),
    );
    const rows: Array<Array<Box>> = await cardRows(
      recentCards(page, "Recently visited"),
    );
    expect(
      rows.map((row: Array<Box>): number => {
        return row.length;
      }),
    ).toEqual([3, 3]);
  });

  test("in the Dashboard's own navbar, on a product's page, the row is at the top and opening the menu logs nothing", async ({
    page,
  }: {
    page: Page;
  }) => {
    const errors: Array<string> = [];
    page.on("console", (message: ConsoleMessage): void => {
      if (message.type() === "error") {
        errors.push(message.text());
      }
    });
    page.on("pageerror", (error: Error): void => {
      errors.push(error.message);
    });
    await page.goto(`${projectPath}/home?navbar=true`);
    await page.evaluate(
      ([key, value]: [string, string]): void => {
        window.localStorage.setItem(key, value);
      },
      [RECENT_STORAGE_KEY, JSON.stringify(SEVEN.map(routeOf))] as [
        string,
        string,
      ],
    );
    await page.goto(`${projectPath}/teams?navbar=true`);
    // On a product's page, the top bar's button names the product.
    const menuButton: Locator = page
      .getByTestId("dashboard-navbar")
      .getByRole("button", { name: TEAMS.title, exact: true });

    // Twice, as on a page in use: the second time every class is drawn.
    await menuButton.click();
    await menuAtRest(page);
    await page.keyboard.press("Escape");
    await expect(productsMenu(page)).toHaveCount(0);
    await menuButton.click();
    await menuAtRest(page);

    await expect(
      productsMenu(page).getByRole("heading", {
        name: "Recently visited",
        exact: true,
      }),
    ).toBeInViewport();
    await expect(
      recentRow(page, "Recently visited").getByRole("option", {
        selected: true,
      }),
    ).toContainText(USERS.title);
    for (let index: number = 0; index < 6; index++) {
      await expect(
        recentCards(page, "Recently visited").nth(index),
      ).toBeInViewport();
    }
    // The footer's link to GitHub is drawn, and nothing was logged.
    await expect(
      productsMenu(page).getByText("Report a bug or request a feature."),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
});
