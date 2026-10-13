import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import { APIResponse, Page, expect, test, Response } from "@playwright/test";
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
    const pagesEntry: string | undefined = sitemapLocs.find((loc: string) => {
      return loc.includes("sitemap-pages.xml");
    });
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
    const homepageRegex: RegExp = /^https?:\/\/[^/]+$/;
    const isHomepage: boolean =
      first!.endsWith("/") || homepageRegex.test(first!);
    expect(isHomepage, "First <loc> should be homepage").toBeTruthy();

    // Final addresses only: the compare hub, and none of the redirects.
    const paths: Array<string> = locs.map((loc: string): string => {
      return new globalThis.URL(loc).pathname;
    });
    expect(paths).toContain("/compare");
    for (const redirecting of [
      "/docs",
      "/reference",
      "/incident-management",
      "/ai-agent",
    ]) {
      expect(paths, `${redirecting} redirects`).not.toContain(redirecting);
    }
    // No date it does not have.
    expect(pagesXml.includes("<lastmod>")).toBeFalsy();
  });

  test("the index lists the docs' and the API reference's sitemaps, which load from the app", async ({
    page,
  }: {
    page: Page;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return; // mirror existing pattern
    }

    page.setDefaultNavigationTimeout(120000);

    const indexXml: string = await fetchSitemapXml(page, "sitemap.xml");
    const sitemapPaths: Array<string> = extractLocs(indexXml).map(
      (loc: string): string => {
        return new globalThis.URL(loc).pathname;
      },
    );

    expect(sitemapPaths).toContain("/sitemap-docs.xml");
    expect(sitemapPaths).toContain("/sitemap-reference.xml");
    expect(
      sitemapPaths.some((sitemapPath: string): boolean => {
        return sitemapPath.startsWith("/sitemap-tags");
      }),
    ).toBeFalsy();

    const docsLocs: Array<string> = extractLocs(
      await fetchSitemapXml(page, "sitemap-docs.xml"),
    );
    expect(
      docsLocs.map((loc: string): string => {
        return new globalThis.URL(loc).pathname;
      }),
    ).toContain("/docs/en/introduction/getting-started");

    const referenceLocs: Array<string> = extractLocs(
      await fetchSitemapXml(page, "sitemap-reference.xml"),
    );
    expect(
      referenceLocs.map((loc: string): string => {
        return new globalThis.URL(loc).pathname;
      }),
    ).toContain("/reference/en/introduction");
  });

  test("the retired tag sitemaps are gone", async ({
    page,
  }: {
    page: Page;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return; // mirror existing pattern
    }

    const response: APIResponse = await page.request.get(
      URL.fromString(`${BASE_URL.toString()}sitemap-tags-1.xml`).toString(),
    );

    expect(response.status()).toBe(410);
  });
});
