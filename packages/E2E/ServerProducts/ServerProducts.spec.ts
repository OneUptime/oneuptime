import { expect, Locator, Page, Request, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * PRODUCTS SWITCHED OFF ON THE SERVER, IN A BROWSER (#6815, #7480).
 *
 * The production pages, against the fixture's in-page answers
 * (ServerProducts/Fixture): what jsdom cannot show is pinned here, at a
 * laptop's and a phone's width, light and dark, in German and Persian
 * (right to left), and never a page that scrolls sideways:
 *
 *   - Admin Dashboard > Settings > Products on a fresh server (Everything
 *     current), after the Monitoring and status pages preset (it is
 *     current, and the page suggests stopping ingestion), with the
 *     Monitoring and status pages profile's ingestion stopped (said, with
 *     the setting), and with the switch per product open (the telemetry
 *     products locked off, saying why);
 *   - the page a switched-off product's address opens: Status Pages for a
 *     member, who is told who can switch it on, and for a master admin,
 *     who gets the button to Admin Dashboard > Settings > Products; and
 *     Logs while ingestion is stopped, which names the setting and has no
 *     button, as no switch brings it back;
 *   - Project Settings > Products with two products off: each says so in
 *     place of its switch, and Monitor Groups is a switch under Monitors.
 *
 * Screenshots land in output/playwright/server-products-ui/, for the people
 * who review the pages.
 */

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/server-products-ui",
);

const PROJECT_PATH: string = "/dashboard/10000000-0000-4000-8000-0000000000c7";

const ADMIN_LOCALES: string = path.resolve(
  __dirname,
  "../../App/FeatureSet/AdminDashboard/src/Locales",
);

const DASHBOARD_LOCALES: string = path.resolve(
  __dirname,
  "../../App/FeatureSet/Dashboard/src/Locales",
);

type Language = "de" | "fa";

interface Look {
  language: Language;
  theme: "light" | "dark";
  width: number;
}

const LAPTOP: number = 1280;
const PHONE: number = 390;

// Every page is looked at in each of these.
const LOOKS: Array<Look> = (["de", "fa"] as Array<Language>).flatMap(
  (language: Language): Array<Look> => {
    return [LAPTOP, PHONE].flatMap((width: number): Array<Look> => {
      return (["light", "dark"] as Array<"light" | "dark">).map(
        (theme: "light" | "dark"): Look => {
          return { language, theme, width };
        },
      );
    });
  },
);

// Each test walks its page through all eight looks.
test.describe.configure({ timeout: 180000 });

type Words = Record<string, unknown>;

const locales: Map<string, Words> = new Map<string, Words>();

// A frontend's words for an English sentence, in a language it speaks.
function wordIn(
  directory: string,
  language: Language,
  english: string,
): string {
  const key: string = `${directory}:${language}`;

  if (!locales.has(key)) {
    locales.set(
      key,
      JSON.parse(
        fs.readFileSync(path.join(directory, `${language}.json`), "utf8"),
      ) as Words,
    );
  }

  const words: unknown = locales.get(key)![english];

  return typeof words === "string" && words ? words : english;
}

function adminWord(language: Language, english: string): string {
  return wordIn(ADMIN_LOCALES, language, english);
}

function dashboardWord(language: Language, english: string): string {
  return wordIn(DASHBOARD_LOCALES, language, english);
}

// Unicode's isolate marks, which set a sentence's values apart.
const ISOLATE_MARKS: RegExp = new RegExp(
  `[${String.fromCharCode(0x2066)}-${String.fromCharCode(0x2069)}]`,
  "g",
);

// What a reader reads: the text without its isolate marks, spaces as one.
async function readText(locator: Locator): Promise<string> {
  return ((await locator.textContent()) || "")
    .replace(ISOLATE_MARKS, "")
    .replace(/\s+/g, " ")
    .trim();
}

function spaced(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function nameOf(look: Look): string {
  return `${look.language}-${look.theme}-${look.width}`;
}

interface FixtureRecord {
  reads?: Array<string>;
  writes?: Array<Record<string, unknown>>;
  unmodeled: Array<Record<string, unknown>>;
}

async function fixtureRecord(page: Page): Promise<FixtureRecord> {
  return await page.evaluate((): FixtureRecord => {
    return (window as unknown as { __serverProductsFixture: FixtureRecord })
      .__serverProductsFixture;
  });
}

/*
 * Opens a page in a look: its width, its theme and its language, nothing
 * fetched from anywhere but the fixture.
 */
async function open(page: Page, look: Look, address: string): Promise<void> {
  await page.setViewportSize({
    width: look.width,
    height: look.width === PHONE ? 844 : 900,
  });

  const separator: string = address.includes("?") ? "&" : "?";

  await page.goto(
    `${address}${separator}lang=${look.language}&theme=${look.theme}`,
  );

  await expect(page.locator("html")).toHaveAttribute("lang", look.language);
  await expect(page.locator("html")).toHaveAttribute(
    "dir",
    look.language === "fa" ? "rtl" : "ltr",
  );
}

// The page fits its width, and is kept for review.
async function looked(page: Page, look: Look, name: string): Promise<void> {
  await expectNoSidewaysScroll(page, {
    soft: true,
    message: `${name} at ${nameOf(look)}`,
  });

  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-${nameOf(look)}.png`),
    fullPage: true,
  });

  expect.soft((await fixtureRecord(page)).unmodeled).toEqual([]);
  // Nothing is fetched from anywhere but the fixture.
  expect.soft(leftTheFixture).toEqual([]);
}

// The requests a test's pages made to anywhere but the fixture.
let leftTheFixture: Array<string> = [];

test.beforeEach(async ({ page }: { page: Page }) => {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  leftTheFixture = [];

  page.on("request", (request: Request): void => {
    if (new URL(request.url()).hostname !== "127.0.0.1") {
      leftTheFixture.push(request.url());
    }
  });
});

test.describe("Admin Dashboard > Settings > Products", () => {
  const ADMIN_PAGE: string = "/admin/settings/products";
  const MONITORING: string = "monitoring-and-status-pages";

  test("a fresh server: Everything is current, and nothing about ingestion", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const look of LOOKS) {
      await open(page, look, `${ADMIN_PAGE}?scene=fresh`);

      await expect(page.getByTestId("server-products")).toContainText(
        adminWord(look.language, "Products on this server"),
      );
      await expect(
        page.getByTestId("server-products-preset-everything"),
      ).toHaveAttribute("data-current", "true");
      await expect(
        page.getByTestId("server-products-preset-everything-current"),
      ).toHaveText(adminWord(look.language, "Current"));
      await expect(
        page.getByTestId(`server-products-preset-${MONITORING}-apply`),
      ).toHaveText(adminWord(look.language, "Use this"));
      await expect(
        page.getByTestId("server-products-ingestion-stopped"),
      ).toHaveCount(0);
      await expect(
        page.getByTestId("server-products-suggest-stopping-ingestion"),
      ).toHaveCount(0);

      await looked(page, look, "admin-fresh");
    }
  });

  test("after the Monitoring and status pages preset: it is current, and the page suggests stopping ingestion", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const look of LOOKS) {
      await open(page, look, `${ADMIN_PAGE}?scene=fresh`);

      await page
        .getByTestId(`server-products-preset-${MONITORING}-apply`)
        .click();

      await expect(
        page.getByTestId(`server-products-preset-${MONITORING}`),
      ).toHaveAttribute("data-current", "true");
      await expect(
        page.getByTestId("server-products-preset-everything"),
      ).toHaveAttribute("data-current", "false");

      const suggestion: Locator = page.getByTestId(
        "server-products-suggest-stopping-ingestion",
      );

      await expect(suggestion).toBeVisible();
      expect(await readText(suggestion)).toContain(
        spaced(
          adminWord(
            look.language,
            "Every telemetry product is off. You can also stop telemetry ingestion to save memory: set DISABLE_TELEMETRY_INGESTION=true (Helm: telemetry.disableIngestion) and restart OneUptime.",
          ),
        ).replace(ISOLATE_MARKS, ""),
      );

      // One write: the preset, as the server takes it.
      expect((await fixtureRecord(page)).writes).toEqual([
        { preset: MONITORING },
      ]);

      await looked(page, look, "admin-after-preset");
    }
  });

  test("the profile, ingestion stopped: said with its setting, the preset set by SERVER_PRODUCTS", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const look of LOOKS) {
      await open(page, look, `${ADMIN_PAGE}?scene=profile`);

      const stopped: Locator = page.getByTestId(
        "server-products-ingestion-stopped",
      );

      await expect(stopped).toBeVisible();
      expect(await readText(stopped)).toContain("DISABLE_TELEMETRY_INGESTION");
      expect(
        await readText(page.getByTestId("server-products-starting-value")),
      ).toContain(`SERVER_PRODUCTS=${MONITORING}`);
      await expect(
        page.getByTestId(`server-products-preset-${MONITORING}`),
      ).toHaveAttribute("data-current", "true");
      // Ingestion is stopped already: nothing to suggest.
      await expect(
        page.getByTestId("server-products-suggest-stopping-ingestion"),
      ).toHaveCount(0);

      await looked(page, look, "admin-ingestion-stopped");
    }
  });

  test("the switch per product, open: the telemetry products locked off, saying why", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const look of LOOKS) {
      await open(page, look, `${ADMIN_PAGE}?scene=profile`);

      const toggle: Locator = page.getByTestId("server-products-one-by-one");

      await expect(toggle).toHaveText(
        adminWord(look.language, "Show Products"),
      );
      await toggle.click();
      await expect(toggle).toHaveText(
        adminWord(look.language, "Hide Products"),
      );

      const monitors: Locator = page.getByTestId(
        "server-product-switch-monitors",
      );
      const kubernetes: Locator = page.getByTestId(
        "server-product-switch-kubernetes",
      );
      const logs: Locator = page.getByTestId("server-product-switch-logs");

      await expect(monitors).toHaveAttribute("aria-checked", "true");
      await expect(kubernetes).toHaveAttribute("aria-checked", "false");
      await expect(logs).toHaveAttribute("aria-checked", "false");
      await expect(logs).toHaveAttribute("aria-disabled", "true");
      await expect(page.getByTestId("server-products")).toContainText(
        adminWord(look.language, "Off while telemetry ingestion is stopped."),
      );

      await looked(page, look, "admin-one-by-one");
    }
  });
});

test.describe("the page a switched-off product's address opens", () => {
  const ASK_ADMIN: string =
    "Ask a server admin to switch it on in Admin Dashboard > Settings > Products.";
  const OPEN_SETTINGS: string = "Open Admin Dashboard > Settings > Products";

  test("Status Pages, for a member: who can switch it on, and no button for it", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const look of LOOKS) {
      await open(page, look, `${PROJECT_PATH}/status-pages?off=status-pages`);

      await expect(page.getByTestId("server-product-off")).toBeVisible();
      await expect(page.getByTestId("product-page")).toHaveCount(0);
      expect(
        await readText(page.getByTestId("server-product-off-next-step")),
      ).toBe(spaced(dashboardWord(look.language, ASK_ADMIN)));
      await expect(
        page.getByTestId("server-product-off-open-settings"),
      ).toHaveCount(0);
      await expect(page.getByTestId("server-product-off-go-home")).toHaveText(
        dashboardWord(look.language, "Go to Home"),
      );

      await looked(page, look, "off-status-pages-member");
    }
  });

  test("Status Pages, for a master admin: the button to Admin Dashboard > Settings > Products", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const look of LOOKS) {
      await open(
        page,
        look,
        `${PROJECT_PATH}/status-pages?off=status-pages&role=admin`,
      );

      await expect(page.getByTestId("server-product-off")).toBeVisible();
      await expect(
        page.getByTestId("server-product-off-open-settings"),
      ).toHaveText(dashboardWord(look.language, OPEN_SETTINGS));
      await expect(
        page.getByTestId("server-product-off-go-home"),
      ).toBeVisible();

      await looked(page, look, "off-status-pages-master-admin");
    }
  });

  test("Logs, with ingestion stopped: the setting that starts it, and no button, even for a master admin", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const look of LOOKS) {
      await open(page, look, `${PROJECT_PATH}/logs?off=ingestion&role=admin`);

      await expect(page.getByTestId("server-product-off")).toBeVisible();
      expect(
        await readText(page.getByTestId("server-product-off-next-step")),
      ).toBe(
        spaced(
          dashboardWord(
            look.language,
            "A server admin can start it again: set DISABLE_TELEMETRY_INGESTION to false and restart OneUptime.",
          ),
        ).replace(ISOLATE_MARKS, ""),
      );
      await expect(
        page.getByTestId("server-product-off-open-settings"),
      ).toHaveCount(0);

      await looked(page, look, "off-logs-ingestion-stopped");
    }
  });
});

test.describe("Project Settings > Products, with two products off on the server", () => {
  test("each says so in place of its switch, and Monitor Groups is a switch under Monitors", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const look of LOOKS) {
      await open(page, look, `${PROJECT_PATH}/settings/products?off=two`);

      await expect(page.getByTestId("products-settings")).toBeVisible();

      for (const product of ["status-pages", "kubernetes"]) {
        await expect(
          page.getByTestId(`product-switch-${product}-off-label`),
        ).toHaveText(
          dashboardWord(look.language, "Switched off on this server"),
        );
        await expect(page.getByTestId(`product-switch-${product}`)).toHaveCount(
          0,
        );
      }

      // Every other product keeps its switch.
      await expect(page.getByTestId("product-switch-monitors")).toHaveAttribute(
        "aria-checked",
        "true",
      );

      const monitors: Locator = page.getByTestId(
        "products-settings-monitors-with-groups",
      );

      await expect(
        monitors.getByTestId("project-monitor-groups-switch"),
      ).toHaveAttribute("aria-checked", "false");
      await expect(monitors).toContainText(
        dashboardWord(look.language, "Monitor Groups"),
      );

      await looked(page, look, "project-settings-products-two-off");
    }
  });
});
