import { expect, Locator, Page, Request, test } from "@playwright/test";

/*
 * The fixture loads its locales as the Dashboard does (#7338).
 *
 * Fixture.js used to import English, German and Arabic whole, so every page
 * of every test loaded a 31 MB bundle, 20 MB of it locales, and with the
 * config's tracing on a test took three times as long as without it: on a
 * loaded machine, five tests of RecentProducts.spec.ts and OnCallNavbar.spec.ts
 * ran past their 30-second timeout without failing an assertion. The fixture
 * now builds the locales as the Dashboard's own build ships them (server.js,
 * createRuntimeLocalesPlugin) and loads German or Arabic, each a chunk of its
 * own, only on a page drawn in it (Fixture.js), as the Dashboard's
 * I18nLocaleLoader does. These hold that: an English page loads neither, and
 * a German or Arabic page loads its own chunk and nothing else, and reads in
 * its language.
 */

const projectPath: string = "/dashboard/00000000-0000-4000-8000-000000000001";

// A locale's own chunk, as esbuild names a dynamically imported de.json.
const LOCALE_CHUNK_PATTERN: RegExp = /^\/dist\/(de|ar)-[A-Z0-9]+\.js$/;

/*
 * The entry chunk's ceiling. With English, German and Arabic bundled whole it
 * was 31 MB; English as the Dashboard ships it, and the rest of the fixture,
 * come to under 4 MB.
 */
const ENTRY_CHUNK_BUDGET_BYTES: number = 8 * 1024 * 1024;

// The languages whose locale chunk the page asks for, in the order asked.
const watchLocaleChunks: (page: Page) => Array<string> = (
  page: Page,
): Array<string> => {
  const requested: Array<string> = [];
  page.on("request", (request: Request): void => {
    const match: RegExpExecArray | null = LOCALE_CHUNK_PATTERN.exec(
      new URL(request.url()).pathname,
    );
    if (match) {
      requested.push(match[1]!);
    }
  });
  return requested;
};

// The desktop bar's menu button, named in the page's language.
const productsButton: (page: Page, name: string) => Locator = (
  page: Page,
  name: string,
): Locator => {
  return page
    .getByTestId("dashboard-navbar")
    .getByRole("button", { name, exact: true });
};

test.describe("the fixture's locales, loaded as the Dashboard loads them", () => {
  test.beforeEach(({ isMobile }: { isMobile: boolean }) => {
    test.skip(
      isMobile,
      "The languages load the same at every width; the desktop bar names Products.",
    );
  });

  test("an English page loads neither German nor Arabic, from an entry a fraction of the size three whole locales made it", async ({
    page,
  }: {
    page: Page;
  }) => {
    const requested: Array<string> = watchLocaleChunks(page);

    await page.goto(`${projectPath}/home?navbar=true`);
    await expect(productsButton(page, "Products")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");

    // A reload, and another page, load no other language either.
    await page.reload();
    await expect(productsButton(page, "Products")).toBeVisible();
    await page.goto(`${projectPath}/monitors?navbar=true`);
    await expect(productsButton(page, "Monitors")).toBeVisible();
    expect(requested).toEqual([]);

    const entry: Buffer = await (
      await page.request.get("/dist/Fixture.js")
    ).body();
    expect(entry.length).toBeGreaterThan(0);
    expect(entry.length).toBeLessThan(ENTRY_CHUNK_BUDGET_BYTES);
  });

  test("a German page loads German's chunk, and only it, and reads German", async ({
    page,
  }: {
    page: Page;
  }) => {
    const requested: Array<string> = watchLocaleChunks(page);

    await page.goto(`${projectPath}/home?navbar=true&lang=de`);
    await expect(productsButton(page, "Produkte")).toBeVisible();
    await expect(productsButton(page, "Products")).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    expect(requested).toEqual(["de"]);
  });

  test("an Arabic page loads Arabic's chunk, and only it, and reads Arabic from right to left", async ({
    page,
  }: {
    page: Page;
  }) => {
    const requested: Array<string> = watchLocaleChunks(page);

    await page.goto(`${projectPath}/home?navbar=true&lang=ar`);
    await expect(productsButton(page, "المنتجات")).toBeVisible();
    await expect(productsButton(page, "Products")).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    expect(requested).toEqual(["ar"]);
  });

  test("the header's page loads the language it is drawn in, and only it", async ({
    page,
  }: {
    page: Page;
  }) => {
    const requested: Array<string> = watchLocaleChunks(page);

    // help.label: "Hilfe" in German, "Help" in English.
    await page.goto(`${projectPath}/home?header=true&lang=de`);
    await expect(page.getByTestId("dashboard-top-section")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Hilfe", exact: true }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    expect(requested).toEqual(["de"]);

    await page.goto(`${projectPath}/home?header=true`);
    await expect(page.getByTestId("dashboard-top-section")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Help", exact: true }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    expect(requested).toEqual(["de"]);
  });

  test("a language the fixture does not draw reads English, and loads no other language", async ({
    page,
  }: {
    page: Page;
  }) => {
    const requested: Array<string> = watchLocaleChunks(page);

    await page.goto(`${projectPath}/home?navbar=true&lang=fr`);
    await expect(productsButton(page, "Products")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    expect(requested).toEqual([]);
  });
});
