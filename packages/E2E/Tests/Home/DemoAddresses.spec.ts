import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import {
  APIResponse,
  Page,
  Response,
  Route,
  expect,
  test,
} from "@playwright/test";

/*
 * oneuptime.com/demo and the demo page, as deployed behind the ingress.
 *
 * oneuptime.com/demo answered 404, and so did every other way people write
 * it. Home's unit tests pin each short address of the demo page
 * (Home/Utils/DemoPage.ts) and where it points, and the ingress suite
 * (Nginx/Tests/NginxConfig.test.js) reads nginx's locations; this suite is
 * the deployment contract: through nginx, each address answers a permanent
 * redirect to /enterprise/demo that keeps the campaign's query string, a
 * browser that types oneuptime.com/demo lands on the demo page, and the
 * page names itself, never a short address, as canonical and in the
 * sitemap.
 */

/*
 * DEMO_SHORT_PATHS of Home/Utils/DemoPage.ts. The e2e image builds without
 * Home, so the list is written out again; Home's Tests/DemoPage.test.ts
 * pins the same one.
 */
const DEMO_SHORT_PATHS: Array<string> = [
  "/demo",
  "/request-demo",
  "/request-a-demo",
  "/book-demo",
  "/book-a-demo",
  "/schedule-demo",
  "/schedule-a-demo",
  "/get-demo",
  "/get-a-demo",
  "/contact-sales",
  "/enterprise/request-demo",
];

const PAGE_PATH: string = "/enterprise/demo";

// What an ad's final URL carries: a campaign's tags and its click id.
const CAMPAIGN_QUERY: string =
  "utm_source=e2e&utm_medium=email&utm_campaign=demo%20address&gclid=e2e-click";

const ORIGIN: string = new URL(BASE_URL.toString()).origin;

const SITEMAP_LOC: RegExp = /<loc>([^<]*)<\/loc>/g;

function addressOn(sitePath: string): string {
  return `${ORIGIN}${sitePath}`;
}

test.describe("Home: oneuptime.com/demo and the demo page", () => {
  test.skip(
    !IS_BILLING_ENABLED,
    "The marketing website is deployed only in billing-enabled environments.",
  );

  test.beforeEach(async ({ page }: { page: Page }) => {
    page.setDefaultNavigationTimeout(120000);

    // Keep the shared consent banner from covering the page.
    await page.addInitScript((): void => {
      localStorage.setItem("cookiesAccepted", "false");
    });

    /*
     * The booking calendar, fonts and analytics are other hosts': refused,
     * so the page is read as this deployment serves it, and loads fast.
     */
    await page.route("**/*", async (route: Route): Promise<void> => {
      if (new URL(route.request().url()).origin === ORIGIN) {
        await route.continue();
        return;
      }

      await route.abort();
    });
  });

  test("every short address answers a permanent redirect to the page, keeping the campaign's query", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const shortPath of DEMO_SHORT_PATHS) {
      // As typed, and with the trailing slash people add.
      for (const requested of [shortPath, `${shortPath}/`]) {
        const response: APIResponse = await page.request.get(
          `${addressOn(requested)}?${CAMPAIGN_QUERY}`,
          { maxRedirects: 0 },
        );
        const location: URL = new URL(
          response.headers()["location"] || "",
          addressOn(requested),
        );

        expect(response.status(), requested).toBe(301);
        expect(location.origin, requested).toBe(ORIGIN);
        expect(`${location.pathname}${location.search}`, requested).toBe(
          `${PAGE_PATH}?${CAMPAIGN_QUERY}`,
        );
      }
    }
  });

  test("a browser that types oneuptime.com/demo lands on the demo page, campaign and all", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${addressOn("/demo")}?${CAMPAIGN_QUERY}`);

    await expect(page).toHaveURL(`${addressOn(PAGE_PATH)}?${CAMPAIGN_QUERY}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Request Demo" }),
    ).toBeVisible();

    await page.goto(addressOn("/Demo/"));

    await expect(page).toHaveURL(addressOn(PAGE_PATH));
    await expect(
      page.getByRole("heading", { level: 1, name: "Request Demo" }),
    ).toBeVisible();
  });

  test("the page answers at its own address and names it as canonical", async ({
    page,
  }: {
    page: Page;
  }) => {
    const response: Response | null = await page.goto(addressOn(PAGE_PATH));

    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(
      "Request a Demo | See the Platform in Action | OneUptime",
    );

    const canonical: string | null = await page
      .locator('link[rel="canonical"]')
      .getAttribute("href");

    expect(new URL(canonical || "", ORIGIN).pathname).toBe(PAGE_PATH);
  });

  test("the pages sitemap names the page, and none of its short addresses", async ({
    page,
  }: {
    page: Page;
  }) => {
    const response: APIResponse = await page.request.get(
      addressOn("/sitemap-pages.xml"),
    );
    const paths: Array<string> = Array.from(
      (await response.text()).matchAll(SITEMAP_LOC),
      (match: RegExpMatchArray): string => {
        return new URL(match[1] || "", ORIGIN).pathname;
      },
    );

    expect(response.status()).toBe(200);
    expect(paths).toContain(PAGE_PATH);

    for (const shortPath of DEMO_SHORT_PATHS) {
      expect(paths, shortPath).not.toContain(shortPath);
    }
  });
});
