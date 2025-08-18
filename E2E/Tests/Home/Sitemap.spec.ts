import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import { Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

// Helper to fetch sitemap XML via a normal page navigation.
async function fetchSitemap(page: Page): Promise<string> {
  const response = await page.goto(
    URL.fromString(`${BASE_URL.toString()}sitemap.xml`).toString(),
    { waitUntil: "networkidle" },
  );
  expect(response, "sitemap.xml should respond").toBeTruthy();
  expect(response?.status(), "sitemap.xml should return 200").toBe(200);

  // Raw content (Playwright wraps XML in HTML view sometimes); extract text.
  const body = await page.$("body");
  const xml = (await body?.innerText()) || (await page.content());
  return xml;
}

function extractLocs(xml: string): string[] {
  const regex = /<loc>(.*?)<\/loc>/g;
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
  test("sitemap loads and has home first", async ({ page }: { page: Page }) => {
    if (!IS_BILLING_ENABLED) {
      return; // mirror existing pattern
    }

    page.setDefaultNavigationTimeout(120000);

    const xml: string = await fetchSitemap(page);
    expect(xml.includes("<urlset")).toBeTruthy();

    const locs: string[] = extractLocs(xml);
    expect(locs.length).toBeGreaterThan(0);

    const first: string | undefined = locs[0];
    expect(first, "First <loc> should exist").toBeTruthy();
    expect(first!.endsWith("/")).toBeTruthy();

    // Ensure at least one dynamic section appears
    const hasBlog: boolean = locs.some((l: string) => /\/blog\b/.test(l));
    const hasCompare: boolean = locs.some((l: string) => /\/compare\//.test(l));
    const hasProductPages: boolean = locs.some((l: string) =>
      (/\/product\//).test(l),
    );
    const hasDocs: boolean = locs.some((l: string) => /\/docs\//.test(l));
    const hasLegal: boolean = locs.some((l: string) => /\/legal\//.test(l));
    expect(hasBlog).toBeTruthy();
    expect(hasCompare).toBeTruthy();
    expect(hasProductPages).toBeTruthy();
    expect(hasDocs).toBeTruthy();
    expect(hasLegal).toBeTruthy();
  });
});
