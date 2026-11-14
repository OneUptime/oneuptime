import {
  ConsoleMessage,
  expect,
  Locator,
  Page,
  Request,
  Route,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * Products that fit the project, and pins that follow the person (issue
 * #6814), in a real browser: the Dashboard's own navbar (?navbar=true) and
 * Project Settings > Products under Home's card for hidden products that
 * have data (?products=true), over the production catalog and English.
 *
 * The project's products come from the API (/api/project-products), which
 * each test answers itself: the products the project hides, the person's
 * pins, what is in use and what the plan cannot use. Every write is
 * recorded and answered as the server answers it, with the products as they
 * now stand.
 *
 * jsdom draws none of this: whether five pins and their names fit the bar
 * at 1280px, that they are icons that still name their product at 1024px,
 * that a card's pin shows when the card is pointed at and can be pressed
 * without opening the product, and that the settings page fits a phone.
 */

/*
 * Each test walks a whole flow - the bar, the menu twice, a write, a
 * screenshot - so it has more time than a single check needs.
 */
test.describe.configure({ timeout: 60000 });

const projectPath: string = "/dashboard/00000000-0000-4000-8000-000000000001";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/navigation-search/products",
);

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

interface ProductsAnswer {
  hidden: Array<string>;
  chosenBy: string | null;
  pinned: Array<string>;
  usage: Record<string, string>;
  neededPlans: Record<string, string>;
  canChooseProducts: boolean;
  hiddenWithData: Array<string>;
}

interface Write {
  path: string;
  body: Record<string, unknown>;
  tenantId: string | null;
}

/*
 * An uptime team's project: it hides the container and cluster products it
 * has no use for, and its owner pinned Status Pages and Incidents.
 */
const UPTIME_PROJECT: ProductsAnswer = {
  hidden: [
    "kubernetes",
    "docker",
    "docker-swarm",
    "podman",
    "proxmox",
    "openstack",
    "vmware",
    "ceph",
  ],
  chosenBy: "member",
  pinned: ["status-pages", "incidents"],
  usage: {
    monitors: "in_use",
    incidents: "in_use",
    "status-pages": "in_use",
    "on-call": "not_set_up",
  },
  neededPlans: { "ai-insights": "Growth" },
  canChooseProducts: true,
  hiddenWithData: [],
};

const FIVE_PINS: Array<string> = [
  "status-pages",
  "incidents",
  "monitors",
  "scheduled-maintenance",
  "on-call",
];

const FIVE_PIN_TITLES: Array<string> = [
  "Status Pages",
  "Incidents",
  "Monitors",
  "Scheduled Maintenance",
  "On-Call",
];

const HIDDEN_TITLES: Array<string> = [
  "Kubernetes",
  "Docker",
  "Docker Swarm",
  "Podman",
  "Proxmox",
  "OpenStack",
  "VMware",
  "Ceph",
];

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

// How opaque an element is drawn, as the browser computes it.
const opacityOf: (locator: Locator) => Promise<number> = async (
  locator: Locator,
): Promise<number> => {
  return Number(
    await locator.evaluate((element: Element): string => {
      return getComputedStyle(element).opacity;
    }),
  );
};

const pageErrors: Map<Page, Array<string>> = new Map();

/*
 * Answers the project's products as the server does: the answer to every
 * read, and to every write the products as the write leaves them.
 */
const serveProducts: (
  page: Page,
  answer: ProductsAnswer,
) => Promise<Array<Write>> = async (
  page: Page,
  answer: ProductsAnswer,
): Promise<Array<Write>> => {
  let current: ProductsAnswer = { ...answer };
  const writes: Array<Write> = [];

  await page.route(/\/api\/project-products/, async (route: Route) => {
    const request: Request = route.request();
    const url: URL = new URL(request.url());

    if (request.method() === "POST") {
      const body: Record<string, unknown> =
        (request.postDataJSON() as Record<string, unknown>) || {};
      writes.push({
        path: url.pathname,
        body: body,
        tenantId: (await request.allHeaders())["tenantid"] || null,
      });

      if (url.pathname.endsWith("/pins")) {
        current = { ...current, pinned: body["pinned"] as Array<string> };
      }

      if (url.pathname.endsWith("/visibility") && body["showAll"] === true) {
        current = {
          ...current,
          chosenBy: "member",
          hidden: [],
          hiddenWithData: [],
        };
      } else if (url.pathname.endsWith("/visibility")) {
        const product: string = body["product"] as string;
        current = {
          ...current,
          chosenBy: "member",
          hidden: body["isShown"]
            ? current.hidden.filter((key: string): boolean => {
                return key !== product;
              })
            : [...current.hidden, product],
          hiddenWithData: current.hiddenWithData.filter(
            (key: string): boolean => {
              return key !== product;
            },
          ),
        };
      }
    }

    await route.fulfill({ json: current });
  });

  return writes;
};

const navbarOf: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByTestId("dashboard-navbar");
};

const pinsOf: (page: Page) => Locator = (page: Page): Locator => {
  return navbarOf(page).getByRole("group", { name: "Pinned", exact: true });
};

// The products menu, in English or in German.
const productsMenu: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByRole("dialog", { name: /^(?:Products menu|Produktmenü)$/ });
};

// A card of the products menu, by its product's name.
const cardOf: (page: Page, title: string) => Locator = (
  page: Page,
  title: string,
): Locator => {
  // By the card's name alone: Docker is not Docker Swarm.
  return productsMenu(page)
    .getByRole("option")
    .filter({ has: page.getByText(title, { exact: true }) });
};

/*
 * The writes once the server has had them: the bar moves before its
 * request lands, so a write is waited for, not read at once.
 */
const writesOnceSent: (
  writes: Array<Write>,
  count: number,
) => Promise<Array<Write>> = async (
  writes: Array<Write>,
  count: number,
): Promise<Array<Write>> => {
  await expect
    .poll((): number => {
      return writes.length;
    })
    .toBe(count);
  return writes;
};

/*
 * The menu opens with a short zoom and fade: measure and press only once
 * nothing in it is moving.
 */
const menuAtRest: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  await expect
    .poll(async (): Promise<number> => {
      return productsMenu(page).evaluate((dialog: Element): number => {
        return dialog.getAnimations({ subtree: true }).length;
      });
    })
    .toBe(0);
};

// The bar's button names the product of the page, or says Products.
const openProductsMenu: (page: Page, button?: string) => Promise<void> = async (
  page: Page,
  button: string = "Products",
): Promise<void> => {
  await navbarOf(page)
    .getByRole("button", { name: button, exact: true })
    .click();
  await expect(productsMenu(page)).toHaveCount(1);
  await menuAtRest(page);
};

const screenshot: (page: Page, name: string) => Promise<void> = async (
  page: Page,
  name: string,
): Promise<void> => {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    animations: "disabled",
  });
};

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("console", (message: ConsoleMessage): void => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error: Error): void => {
    errors.push(error.message);
  });
});

test.afterEach(({ page }: { page: Page }) => {
  // Nothing logged an error: no request refused, no answer misread.
  expect(pageErrors.get(page) || []).toEqual([]);
});

test.describe("pins beside Home and Products", () => {
  test.beforeEach(({ isMobile }: { isMobile: boolean }) => {
    test.skip(isMobile, "A phone lists the pins in its menu (see below).");
  });

  test("the bar shows the person's pins in their order, right of Products, and each opens its product", async ({
    page,
  }: {
    page: Page;
  }) => {
    await serveProducts(page, UPTIME_PROJECT);
    await page.goto(`${projectPath}/home?navbar=true`);

    const pins: Locator = pinsOf(page).getByRole("link");
    await expect(pins).toHaveCount(2);
    await expect(pins.nth(0)).toHaveText("Status Pages");
    await expect(pins.nth(1)).toHaveText("Incidents");

    // On the products' row, after the Products button.
    const products: Box = await boxOf(
      navbarOf(page).getByRole("button", { name: "Products", exact: true }),
    );
    const first: Box = await boxOf(pins.nth(0));
    expect(first.x).toBeGreaterThan(products.x + products.width - 1);
    expect(
      Math.abs(first.y + first.height / 2 - products.y - products.height / 2),
    ).toBeLessThan(4);

    await pins.nth(1).click();
    await expect(page.getByTestId("current-route")).toHaveText(
      `${projectPath}/incidents`,
    );
    // The pin of the product on screen reads as the current page.
    await expect(pins.nth(1)).toHaveAttribute("aria-current", "page");
    await expect(pins.nth(0)).not.toHaveAttribute("aria-current", "page");

    await screenshot(page, "bar-with-pins-1280");
  });

  test("a card's pin in the menu pins its product beside the others, and the server keeps it", async ({
    page,
  }: {
    page: Page;
  }) => {
    const writes: Array<Write> = await serveProducts(page, UPTIME_PROJECT);
    await page.goto(`${projectPath}/home?navbar=true`);
    await expect(pinsOf(page).getByRole("link")).toHaveCount(2);
    await openProductsMenu(page);

    /*
     * A card's pin is out of sight until the card is pointed at (the
     * cursor's card, Monitors, shows its own).
     */
    const alerts: Locator = cardOf(page, "Alerts");
    const slot: Locator = alerts.getByTestId("navbar-menu-pin-slot");
    await expect
      .poll((): Promise<number> => {
        return opacityOf(slot);
      })
      .toBe(0);
    await expect
      .poll((): Promise<number> => {
        return opacityOf(
          cardOf(page, "Monitors").getByTestId("navbar-menu-pin-slot"),
        );
      })
      .toBe(1);
    await alerts.hover();
    await expect
      .poll((): Promise<number> => {
        return opacityOf(slot);
      })
      .toBe(1);
    const pin: Locator = alerts.getByRole("button", { name: "Pin Alerts" });
    await expect(pin).toHaveAttribute("aria-pressed", "false");
    await pin.click();

    // Pressing it pins the product, and opens nothing.
    await expect(
      alerts.getByRole("button", { name: "Unpin Alerts" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(productsMenu(page)).toHaveCount(1);
    await expect(page.getByTestId("current-route")).toHaveText(
      `${projectPath}/home`,
    );
    await expect(pinsOf(page).getByRole("link")).toHaveText([
      "Status Pages",
      "Incidents",
      "Alerts",
    ]);
    expect(await writesOnceSent(writes, 1)).toEqual([
      {
        path: "/api/project-products/pins",
        body: { pinned: ["status-pages", "incidents", "alerts"] },
        tenantId: "00000000-0000-4000-8000-000000000001",
      },
    ]);

    // A pinned card keeps its pin in sight, and pressing it again unpins.
    await expect
      .poll((): Promise<number> => {
        return opacityOf(
          cardOf(page, "Incidents").getByTestId("navbar-menu-pin-slot"),
        );
      })
      .toBe(1);
    await cardOf(page, "Incidents")
      .getByRole("button", { name: "Unpin Incidents" })
      .click();
    await expect(pinsOf(page).getByRole("link")).toHaveText([
      "Status Pages",
      "Alerts",
    ]);
    expect((await writesOnceSent(writes, 2))[1]!.body).toEqual({
      pinned: ["status-pages", "alerts"],
    });
  });

  test("with five pinned, the pin of a sixth cannot be pressed, and says why", async ({
    page,
  }: {
    page: Page;
  }) => {
    const writes: Array<Write> = await serveProducts(page, {
      ...UPTIME_PROJECT,
      pinned: FIVE_PINS,
    });
    await page.goto(`${projectPath}/home?navbar=true`);
    await expect(pinsOf(page).getByRole("link")).toHaveCount(5);
    await openProductsMenu(page);

    const alerts: Locator = cardOf(page, "Alerts");
    await alerts.hover();
    const pin: Locator = alerts.getByRole("button", { name: "Pin Alerts" });
    await expect(pin).toBeDisabled();
    await expect(pin).toHaveAttribute(
      "title",
      "You can pin up to 5 products. Unpin one first.",
    );
    await pin.click({ force: true });
    await expect(pinsOf(page).getByRole("link")).toHaveCount(5);
    expect(writes).toEqual([]);

    // A pinned one can still be unpinned.
    await expect(
      cardOf(page, "Monitors").getByRole("button", { name: "Unpin Monitors" }),
    ).toBeEnabled();
  });

  test("five pins and their names fit the bar at 1280px, and at 1024px they are icons that still name their product", async ({
    page,
  }: {
    page: Page;
  }) => {
    await serveProducts(page, { ...UPTIME_PROJECT, pinned: FIVE_PINS });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${projectPath}/home?navbar=true`);

    const pins: Locator = pinsOf(page).getByRole("link");
    await expect(pins).toHaveText(FIVE_PIN_TITLES);
    for (let index: number = 0; index < FIVE_PIN_TITLES.length; index++) {
      await expect(pins.nth(index)).toBeInViewport();
    }
    // Every name is drawn, and the bar does not scroll sideways.
    await expect(pins.nth(3).getByText("Scheduled Maintenance")).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "bar-with-five-pins-1280");

    await page.setViewportSize({ width: 1024, height: 800 });
    // Below 1280px a pin is its icon; its name is still its link's name.
    for (let index: number = 0; index < FIVE_PIN_TITLES.length; index++) {
      await expect(pins.nth(index)).toBeInViewport();
      await expect(pins.nth(index)).toHaveAttribute(
        "title",
        FIVE_PIN_TITLES[index]!,
      );
      expect((await boxOf(pins.nth(index))).width).toBeLessThan(48);
    }
    await expect(pins).toHaveText(FIVE_PIN_TITLES);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "bar-with-five-pins-1024");
  });
});

test.describe("products the project hides", () => {
  test.beforeEach(({ isMobile }: { isMobile: boolean }) => {
    test.skip(isMobile, "The phone menu is covered below.");
  });

  test("the menu lists them last, under More products, and says Search still finds them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await serveProducts(page, UPTIME_PROJECT);
    await page.goto(`${projectPath}/home?navbar=true`);
    await openProductsMenu(page);

    const rows: Locator = productsMenu(page).locator(
      "#navbar-menu-listbox button[aria-expanded]",
    );
    await expect(rows.last()).toHaveText("More products");
    // Infrastructure keeps the products the project uses, and no others.
    const infrastructure: Locator = productsMenu(page).getByRole("button", {
      name: "Infrastructure",
      exact: true,
    });
    await infrastructure.click();
    await expect(cardOf(page, "Hosts")).toHaveCount(1);
    await expect(cardOf(page, "Kubernetes")).toHaveCount(0);

    await rows.last().click();
    await expect(rows.last()).toHaveAttribute("aria-expanded", "true");
    for (const title of HIDDEN_TITLES) {
      await expect(cardOf(page, title)).toHaveCount(1);
    }
    const footer: Locator = productsMenu(page).getByTestId(
      "navbar-menu-hidden-footer",
    );
    await expect(footer).toContainText(
      "Hidden in this project. Search still finds them, and their pages work.",
    );
    await footer.scrollIntoViewIfNeeded();
    await screenshot(page, "menu-more-products-1280");

    // Search finds a hidden product, and opens it.
    await page
      .getByRole("combobox", { name: "Search products" })
      .fill("kubernetes");
    await expect(cardOf(page, "Kubernetes")).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("current-route")).toHaveText(
      `${projectPath}/kubernetes`,
    );
  });

  test("Choose products opens Project Settings > Products, for those who may choose", async ({
    page,
  }: {
    page: Page;
  }) => {
    await serveProducts(page, UPTIME_PROJECT);
    await page.goto(`${projectPath}/home?navbar=true`);
    await openProductsMenu(page);
    await productsMenu(page)
      .getByRole("button", { name: "More products", exact: true })
      .click();
    await productsMenu(page)
      .getByRole("link", { name: "Choose products", exact: true })
      .click();
    await expect(productsMenu(page)).toHaveCount(0);
    await expect(page.getByTestId("current-route")).toHaveText(
      `${projectPath}/settings/products`,
    );
  });

  test("a member who may not choose reads the note without the link", async ({
    page,
  }: {
    page: Page;
  }) => {
    await serveProducts(page, { ...UPTIME_PROJECT, canChooseProducts: false });
    await page.goto(`${projectPath}/home?navbar=true`);
    await openProductsMenu(page);
    await productsMenu(page)
      .getByRole("button", { name: "More products", exact: true })
      .click();
    await expect(
      productsMenu(page).getByTestId("navbar-menu-hidden-footer"),
    ).toContainText("Search still finds them");
    await expect(
      productsMenu(page).getByRole("link", { name: "Choose products" }),
    ).toHaveCount(0);
  });

  test("a card names the plan a product needs, and says when a product is not set up", async ({
    page,
  }: {
    page: Page;
  }) => {
    await serveProducts(page, UPTIME_PROJECT);
    await page.goto(`${projectPath}/home?navbar=true`);
    await openProductsMenu(page);

    await expect(
      cardOf(page, "On-Call").getByTestId("navbar-menu-not-set-up"),
    ).toHaveText("Not set up");
    await expect(
      cardOf(page, "Monitors").getByTestId("navbar-menu-not-set-up"),
    ).toHaveCount(0);

    // AI Insights is called Insights in the menu.
    await productsMenu(page)
      .getByRole("combobox", { name: "Search products" })
      .fill("insights");
    await expect(
      cardOf(page, "Insights").getByTestId("navbar-menu-plan"),
    ).toHaveText("Growth Plan");
  });

  test("with nothing hidden or pinned, the bar and the menu are as they were", async ({
    page,
  }: {
    page: Page;
  }) => {
    // What every existing project sees until someone changes the setting.
    await serveProducts(page, {
      ...UPTIME_PROJECT,
      hidden: [],
      chosenBy: null,
      pinned: [],
      usage: {},
      neededPlans: {},
    });
    await page.goto(`${projectPath}/home?navbar=true`);
    await expect(pinsOf(page)).toHaveCount(0);
    await openProductsMenu(page);
    await expect(
      productsMenu(page).getByRole("button", { name: "More products" }),
    ).toHaveCount(0);
    await expect(
      productsMenu(page).getByTestId("navbar-menu-not-set-up"),
    ).toHaveCount(0);
    await screenshot(page, "menu-nothing-hidden-1280");
  });
});

test.describe("in German, in Arabic and in the dark", () => {
  test.beforeEach(({ isMobile }: { isMobile: boolean }) => {
    test.skip(isMobile, "The bar's pins are a desktop row.");
  });

  test("in German, five pins still fit the bar at 1280px, a long name cut short and kept whole in its title", async ({
    page,
  }: {
    page: Page;
  }) => {
    await serveProducts(page, { ...UPTIME_PROJECT, pinned: FIVE_PINS });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${projectPath}/home?navbar=true&lang=de`);

    const pins: Locator = page.getByTestId("navbar-pinned").getByRole("link");
    await expect(pins).toHaveCount(5);
    for (let index: number = 0; index < 5; index++) {
      await expect(pins.nth(index)).toBeInViewport({ ratio: 1 });
      // A name is cut short at 10rem, beside a 16px icon and its gap.
      expect((await boxOf(pins.nth(index))).width).toBeLessThanOrEqual(
        16 * 10 + 16 + 6 + 2 * 12 + 1,
      );
      expect(await pins.nth(index).getAttribute("title")).toBeTruthy();
    }
    await expectNoSidewaysScroll(page);
    await screenshot(page, "bar-with-five-pins-1280-de");

    await navbarOf(page)
      .getByRole("button", { name: "Produkte", exact: true })
      .click();
    await menuAtRest(page);
    const rows: Locator = productsMenu(page).locator(
      "#navbar-menu-listbox button[aria-expanded]",
    );
    await expect(rows.last()).toHaveText("Weitere Produkte");
    await rows.last().click();
    await productsMenu(page)
      .getByTestId("navbar-menu-hidden-footer")
      .scrollIntoViewIfNeeded();
    await screenshot(page, "menu-more-products-1280-de");
  });

  test("in Arabic the bar reads from the right: the pins sit after Products, to its left", async ({
    page,
  }: {
    page: Page;
  }) => {
    await serveProducts(page, UPTIME_PROJECT);
    await page.goto(`${projectPath}/home?navbar=true&lang=ar`);

    const pins: Locator = page.getByTestId("navbar-pinned").getByRole("link");
    await expect(pins).toHaveCount(2);
    const products: Box = await boxOf(
      navbarOf(page).getByRole("button", { name: "المنتجات", exact: true }),
    );
    const first: Box = await boxOf(pins.nth(0));
    const second: Box = await boxOf(pins.nth(1));
    expect(first.x + first.width).toBeLessThanOrEqual(products.x + 1);
    expect(second.x + second.width).toBeLessThanOrEqual(first.x + 1);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "bar-with-pins-1280-ar");
  });

  test("in the dark, the pins and the menu's hidden row are drawn in the dark theme", async ({
    page,
  }: {
    page: Page;
  }) => {
    await serveProducts(page, UPTIME_PROJECT);
    // On Monitors' page, where neither Home nor a pin is the current page.
    await page.goto(`${projectPath}/monitors?navbar=true`);
    await page.addStyleTag({ path: THEME_CSS_PATH });
    await page.evaluate((): void => {
      document.documentElement.classList.add("dark");
      document.body.style.background = "#0b1120";
    });

    // A pin's name is drawn as Home's is, in the dark theme's words colour.
    const pin: Locator = pinsOf(page).getByRole("link").first();
    const home: Locator = navbarOf(page).getByRole("link", {
      name: /^Home(?:\s|$)/,
    });
    const colorOf: (locator: Locator) => Promise<string> = async (
      locator: Locator,
    ): Promise<string> => {
      return locator.evaluate((element: Element): string => {
        return getComputedStyle(element).color;
      });
    };
    await expect(pin).not.toHaveAttribute("aria-current", "page");
    await expect(home).not.toHaveAttribute("aria-current", "page");
    expect(await colorOf(pin)).toBe(await colorOf(home));

    await openProductsMenu(page, "Monitors");
    await productsMenu(page)
      .getByRole("button", { name: "More products", exact: true })
      .click();
    await productsMenu(page)
      .getByTestId("navbar-menu-hidden-footer")
      .scrollIntoViewIfNeeded();
    await screenshot(page, "menu-more-products-1280-dark");
  });
});

test("on a phone, the menu lists the pins first and the hidden products last", async ({
  page,
  isMobile,
}: {
  page: Page;
  isMobile: boolean;
}) => {
  test.skip(!isMobile, "The phone menu exists below 768px only.");

  await serveProducts(page, UPTIME_PROJECT);
  await page.goto(`${projectPath}/home?navbar=true`);
  const navbar: Locator = navbarOf(page);
  await navbar.getByTestId("mobile-nav-toggle").click();

  const pinned: Locator = navbar.getByTestId("navbar-mobile-pinned");
  await expect(pinned.getByRole("link")).toHaveText([
    "Status Pages",
    "Incidents",
  ]);
  // Right under Home, before the sections.
  const home: Box = await boxOf(
    navbar.getByRole("link", { name: /^Home(?:\s|$)/ }),
  );
  const essentials: Box = await boxOf(
    navbar.getByRole("button", { name: "Essentials", exact: true }),
  );
  const pins: Box = await boxOf(pinned);
  expect(pins.y).toBeGreaterThanOrEqual(home.y + home.height - 1);
  expect(pins.y + pins.height).toBeLessThanOrEqual(essentials.y + 1);

  const more: Locator = navbar.getByRole("button", {
    name: "More products",
    exact: true,
  });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  const settings: Box = await boxOf(
    navbar.getByRole("button", { name: "Settings", exact: true }),
  );
  expect((await boxOf(more)).y).toBeGreaterThan(settings.y);
  await more.click();
  await expect(
    navbar.getByRole("link", { name: /^Kubernetes(?:\s|$)/ }),
  ).toBeVisible();
  await expectNoSidewaysScroll(page);
  await screenshot(page, "phone-menu-pins-and-more-products");
});

test.describe("Project Settings > Products", () => {
  test("lists every product by its section, each with a switch, and the ones always shown say so", async ({
    page,
    isMobile,
  }: {
    page: Page;
    isMobile: boolean;
  }) => {
    await serveProducts(page, UPTIME_PROJECT);
    await page.goto(`${projectPath}/settings/products?products=true`);

    const settings: Locator = page.getByTestId("products-settings");
    await expect(settings).toBeVisible();
    await expect(page.getByTestId("product-switch-monitors")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.getByTestId("product-switch-kubernetes")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await expect(page.getByTestId("product-switch-users-row")).toContainText(
      "Always shown",
    );
    await expect(page.getByTestId("product-switch-users")).toHaveCount(0);
    await expect(
      page.getByTestId("product-switch-monitors-in-use"),
    ).toBeVisible();
    await expect(
      page.getByTestId("product-switch-on-call-not-set-up"),
    ).toBeVisible();
    await expect(
      page.getByTestId("product-switch-ai-insights-plan"),
    ).toContainText("Growth");

    await expectNoSidewaysScroll(page);
    await screenshot(
      page,
      isMobile ? "settings-products-phone" : "settings-products-1280",
    );
  });

  test("a switch hides a product at once, says Saved, and the server is told", async ({
    page,
  }: {
    page: Page;
  }) => {
    const writes: Array<Write> = await serveProducts(page, UPTIME_PROJECT);
    await page.goto(`${projectPath}/settings/products?products=true`);

    const logs: Locator = page.getByTestId("product-switch-logs");
    await expect(logs).toHaveAttribute("aria-checked", "true");
    await logs.click();
    await expect(logs).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("product-switch-logs-status")).toHaveText(
      "Saved",
    );
    expect(await writesOnceSent(writes, 1)).toEqual([
      {
        path: "/api/project-products/visibility",
        body: { product: "logs", isShown: false },
        tenantId: "00000000-0000-4000-8000-000000000001",
      },
    ]);

    // Show Every Product brings back every hidden product in one write.
    await page.getByTestId("products-settings-show-all").click();
    await expect(page.getByTestId("product-switch-kubernetes")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(logs).toHaveAttribute("aria-checked", "true");
    expect((await writesOnceSent(writes, 2))[1]!.body).toEqual({
      showAll: true,
    });
  });

  test("Home's card says which hidden products have data, and Show It brings one back", async ({
    page,
  }: {
    page: Page;
  }) => {
    const writes: Array<Write> = await serveProducts(page, {
      ...UPTIME_PROJECT,
      hiddenWithData: ["docker"],
    });
    await page.goto(`${projectPath}/home?products=true`);

    const card: Locator = page.getByTestId("home-hidden-products-with-data");
    await expect(card).toContainText(
      "Docker is hidden in this project and has data.",
    );
    await card.getByRole("button", { name: "Show It" }).click();
    await expect(card).toHaveCount(0);
    expect((await writesOnceSent(writes, 1))[0]!.body).toEqual({
      product: "docker",
      isShown: true,
    });
    await expect(page.getByTestId("product-switch-docker")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});
