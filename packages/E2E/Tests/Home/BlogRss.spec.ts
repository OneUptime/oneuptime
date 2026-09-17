import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * The Home service serves a dynamic blog RSS feed at /blog/rss.xml
 * (Home/Routes.ts -> RssFeed.generateBlogRssFeed). Its contract:
 *
 *   - 200, served as application/rss+xml (a feed reader keys off this, not the
 *     body — an HTML content-type makes aggregators reject the feed).
 *   - A well-formed RSS 2.0 channel: <rss version="2.0"> with a <channel> and
 *     the "OneUptime Blog" title, plus the atom self-link pointing back at the
 *     feed URL that validators require.
 *   - The per-tag feed at /blog/tag/:tagName/rss.xml serves the same shape and
 *     titles itself after the tag.
 *
 * These assert structure only (never a specific post), so they hold whether the
 * deployment has zero blog posts or many. They run only where the Home
 * marketing site is deployed, which the suite gates on IS_BILLING_ENABLED,
 * consistent with the other Home specs.
 */

test.describe("Home: blog RSS feed", () => {
  test("the blog feed is well-formed RSS served as application/rss+xml", async ({
    page,
  }: {
    page: Page;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return; // Home marketing site is only deployed in the SaaS stack.
    }

    page.setDefaultNavigationTimeout(120000); // 2 minutes

    const endpoint: string = URL.fromString(BASE_URL.toString())
      .addRoute("/blog/rss.xml")
      .toString();

    const response: APIResponse = await page.request.get(endpoint);

    expect(response.status()).toBe(200);

    const contentType: string = response.headers()["content-type"] || "";
    expect(contentType).toContain("application/rss+xml");

    const body: string = await response.text();

    expect(body).toContain('<rss version="2.0"');
    expect(body).toContain("<channel>");
    expect(body).toContain("<title>OneUptime Blog</title>");
    // Atom self-link that feed validators require, pointing back at this feed.
    expect(body).toContain("/blog/rss.xml");
  });

  test("a per-tag feed serves the same RSS shape", async ({
    page,
  }: {
    page: Page;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return;
    }

    page.setDefaultNavigationTimeout(120000);

    const endpoint: string = URL.fromString(BASE_URL.toString())
      .addRoute("/blog/tag/observability/rss.xml")
      .toString();

    const response: APIResponse = await page.request.get(endpoint);

    expect(response.status()).toBe(200);

    const contentType: string = response.headers()["content-type"] || "";
    expect(contentType).toContain("application/rss+xml");

    const body: string = await response.text();

    expect(body).toContain('<rss version="2.0"');
    expect(body).toContain("<channel>");
    // The tag feed titles itself after the tag it serves.
    expect(body).toContain("OneUptime Blog - ");
  });
});
