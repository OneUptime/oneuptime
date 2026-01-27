import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import { Page, expect, test, Response } from "@playwright/test";
import URL from "Common/Types/API/URL";

// Helper to fetch sitemap XML via a normal page navigation.
async function fetchSitemapXml(page: Page, path: string): Promise<string> {
  const response: Response | null = await page.goto(
    URL.fromString(`${BASE_URL.toString()}${path}`).toString(),
    { waitUntil: "networkidle" },
  );
  expect(response, `${path} should respond`).toBeTruthy();
  expect(response?.status(), `${path} should return 200`).toBe(200);

  // Raw content (Playwright wraps XML in HTML view sometimes); extract text.
  const body: Awaited<ReturnType<typeof page.$>> = await page.$("body");
  const xml: string = (await body?.innerText()) || (await page.content());
  return xml;
}

function extractLocs(xml: string): string[] {
  const regex: RegExp = /<loc>(.*?)<\/loc>/g;
  const locs: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    if (match[1]) {
      locs.push(match[1]);
    }
  }
  return locs;
}

test.describe("Home: Sitemap", () => {
  test("sitemap index loads and contains child sitemaps", async ({
    page,
  }: {
    page: Page;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return; // mirror existing pattern
    }

    page.setDefaultNavigationTimeout(120000);

    // Test the sitemap index
    const indexXml: string = await fetchSitemapXml(page, "sitemap.xml");
    expect(indexXml.includes("<sitemapindex")).toBeTruthy();

    const sitemapLocs: string[] = extractLocs(indexXml);
    expect(sitemapLocs.length).toBeGreaterThan(0);

    // Verify sitemap-pages.xml is in the index
    const pagesEntry: string | undefined = sitemapLocs.find(
      (loc: string) => loc.includes("sitemap-pages.xml"),
    );
    expect(pagesEntry, "sitemap-pages.xml should be in index").toBeTruthy();
  });

  test("sitemap-pages loads and has home first", async ({
    page,
  }: {
    page: Page;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return; // mirror existing pattern
    }

    page.setDefaultNavigationTimeout(120000);

    // Test the pages sitemap
    const pagesXml: string = await fetchSitemapXml(page, "sitemap-pages.xml");
    expect(pagesXml.includes("<urlset")).toBeTruthy();

    const locs: string[] = extractLocs(pagesXml);
    expect(locs.length).toBeGreaterThan(0);

    // The first entry should be the homepage (no trailing path or ends with /)
    const first: string | undefined = locs[0];
    expect(first, "First <loc> should exist").toBeTruthy();
    // Homepage URL either ends with / or has no path after domain
    const isHomepage: boolean =
      first!.endsWith("/") ||
      /^https?:\/\/[^\/]+$/.test(first!);
    expect(isHomepage, "First <loc> should be homepage").toBeTruthy();
  });
});
