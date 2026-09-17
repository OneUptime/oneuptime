import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import { APIResponse, Page, Response, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * The /compare/<competitor> pages are SEO-indexed, sales-critical landing
 * pages served three ways from the same ProductCompare table (Home/Utils):
 * the rendered HTML page, the /compare/<slug>.md markdown variant, and the
 * /compare index. Home/Tests/ProductCompare.test.ts already pins the data
 * model; this suite is the deployment contract — it proves the routes are
 * actually mounted, return the right status and content type, and that an
 * unknown competitor 404s instead of rendering a blank shell.
 *
 * Like the other Home specs, these run only where the marketing site is
 * deployed, which the suite gates on IS_BILLING_ENABLED.
 */

function urlFor(path: string): string {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
}

test.describe("Home: Product comparison pages", () => {
  test("the /compare index loads as an HTML page", async ({
    page,
  }: {
    page: Page;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return; // Home marketing site is only deployed in the SaaS stack.
    }

    page.setDefaultNavigationTimeout(120000);

    const response: Response | null = await page.goto(urlFor("/compare"), {
      waitUntil: "networkidle",
    });

    expect(response?.status()).toBe(200);
    expect(response?.headers()["content-type"] || "").toContain("text/html");
  });

  test("a flagship competitor page renders with both product names", async ({
    page,
  }: {
    page: Page;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return;
    }

    page.setDefaultNavigationTimeout(120000);

    const response: Response | null = await page.goto(
      urlFor("/compare/pagerduty"),
      { waitUntil: "networkidle" },
    );

    expect(response?.status()).toBe(200);

    const bodyHandle: Awaited<ReturnType<typeof page.$>> = await page.$("body");
    const body: string = (await bodyHandle?.innerText()) || "";

    /*
     * A comparison page must name the competitor and OneUptime; a blank shell
     * (missing data) would drop both.
     */
    expect(body).toContain("PagerDuty");
    expect(body).toContain("OneUptime");
  });

  test("the .md variant is served as markdown with an open CORS policy", async ({
    page,
  }: {
    page: Page;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return;
    }

    page.setDefaultNavigationTimeout(120000);

    const response: APIResponse = await page.request.get(
      urlFor("/compare/pagerduty.md"),
    );

    expect(response.status()).toBe(200);

    const headers: { [key: string]: string } = response.headers();
    expect(headers["content-type"] || "").toContain("text/markdown");
    // The markdown variants are fetched cross-origin by LLMs/agents.
    expect(headers["access-control-allow-origin"]).toBe("*");

    const body: string = await response.text();
    expect(body).toContain("PagerDuty");
    // Guard against the 404 fallback body being served with a 200.
    expect(body).not.toContain("No markdown variant");
  });

  test("a brand slug containing a dot still resolves", async ({
    page,
  }: {
    page: Page;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return;
    }

    page.setDefaultNavigationTimeout(120000);

    /*
     * Regression guard: "incident.io" is a real slug, and the dot must not be
     * swallowed by the `\.md$` markdown route or truncated by path parsing.
     */
    const response: Response | null = await page.goto(
      urlFor("/compare/incident.io"),
      { waitUntil: "networkidle" },
    );

    expect(response?.status()).toBe(200);
  });

  test("an unknown competitor returns 404, not a blank page", async ({
    page,
  }: {
    page: Page;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return;
    }

    page.setDefaultNavigationTimeout(120000);

    const htmlResponse: Response | null = await page.goto(
      urlFor("/compare/definitely-not-a-real-competitor"),
      { waitUntil: "networkidle" },
    );
    expect(htmlResponse?.status()).toBe(404);

    // The markdown route has its own 404 path with an explanatory body.
    const mdResponse: APIResponse = await page.request.get(
      urlFor("/compare/definitely-not-a-real-competitor.md"),
    );
    expect(mdResponse.status()).toBe(404);
    expect(await mdResponse.text()).toContain("No markdown variant");
  });
});
