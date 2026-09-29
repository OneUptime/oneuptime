import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * The Home service serves a dynamic /robots.txt (Home/Routes.ts). Its contract:
 *
 *   - Any host that is NOT the canonical production domain (oneuptime.com) —
 *     which every E2E deployment, preview and on-prem install is — must return
 *     "User-agent: *" + "Disallow: /" so test/preview/self-hosted domains are
 *     never indexed by search engines. A regression that flips this to
 *     "Allow: /" would silently expose non-production deployments to crawlers.
 *   - It is served as text/plain (not HTML), with a 200 status.
 *
 * These checks run only where the Home marketing site is deployed, which the
 * suite gates on IS_BILLING_ENABLED, consistent with the other Home specs.
 */

test.describe("Home: robots.txt", () => {
  test("serves text/plain and disallows indexing on non-production hosts", async ({
    page,
  }: {
    page: Page;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return; // Home marketing site is only deployed in the SaaS stack.
    }

    page.setDefaultNavigationTimeout(120000); // 2 minutes

    const endpoint: string = URL.fromString(BASE_URL.toString())
      .addRoute("/robots.txt")
      .toString();

    const response: APIResponse = await page.request.get(endpoint);

    // Must be a 200.
    expect(response.status()).toBe(200);

    // Must be served as plain text, not an HTML document.
    const contentType: string = response.headers()["content-type"] || "";
    expect(contentType).toContain("text/plain");

    const body: string = await response.text();

    // The E2E deployment is never oneuptime.com, so indexing must be disallowed.
    expect(body).toContain("User-agent: *");
    expect(body).toContain("Disallow: /");
  });

  test("does not open the whole site to crawlers on a non-production host", async ({
    page,
  }: {
    page: Page;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return;
    }

    page.setDefaultNavigationTimeout(120000);

    const endpoint: string = URL.fromString(BASE_URL.toString())
      .addRoute("/robots.txt")
      .toString();

    const response: APIResponse = await page.request.get(endpoint);
    const body: string = await response.text();

    /*
     * On a non-production host the handler emits exactly the disallow-all
     * block and no "Allow: /" line. Asserting the absence of "Allow: /"
     * guards against a regression that serves the production (index-me)
     * robots body on preview / on-prem domains.
     */
    expect(body).not.toContain("Allow: /");
  });
});
