import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * The Home service exposes machine-readable marketing data at /data/*.json
 * (Home/Routes.ts): pricing, products, reviews, the governed claims matrix,
 * and the competitor-comparison index, plus a per-competitor /data/compare/:slug
 * document. Sales tooling, RFP automation, and AI agents read these instead of
 * scraping the rendered landing pages.
 *
 * Unit tests already pin the generator output (Home/Tests/AIDiscovery.test.ts,
 * Routes.test.ts). This suite is the deployment contract: it proves the routes
 * are actually mounted behind nginx, return 200 with an application/json body,
 * carry the open CORS header (they are fetched cross-origin by agents) and the
 * 10-minute cache header, parse as JSON with the documented top-level shape,
 * and are not accidentally serving an HTML error page with a 200. These run
 * only where the Home marketing site is deployed, which the suite gates on
 * IS_BILLING_ENABLED like the other Home specs.
 */

function endpointFor(path: string): string {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
}

// Each marketing data endpoint returns an object with one primary array key.
const ARRAY_ENDPOINTS: Array<{ path: string; arrayKey: string }> = [
  { path: "/data/products.json", arrayKey: "products" },
  { path: "/data/reviews.json", arrayKey: "reviews" },
  { path: "/data/claims.json", arrayKey: "claims" },
  { path: "/data/compare.json", arrayKey: "comparisons" },
];

test.describe("Home: machine-readable marketing data", () => {
  for (const { path, arrayKey } of ARRAY_ENDPOINTS) {
    test(`${path} is served as JSON with an open CORS policy and a non-empty ${arrayKey} array`, async ({
      page,
    }: {
      page: Page;
    }) => {
      if (!IS_BILLING_ENABLED) {
        return; // Home marketing site is only deployed in the SaaS stack.
      }

      page.setDefaultNavigationTimeout(120000); // 2 minutes

      const response: APIResponse = await page.request.get(endpointFor(path));

      expect(response.status()).toBe(200);

      const headers: { [key: string]: string } = response.headers();
      // A regression that unmounts the route serves the SPA/HTML fallback.
      expect(headers["content-type"] || "").toContain("application/json");
      // Fetched cross-origin by crawlers/agents, so it must be world-readable.
      expect(headers["access-control-allow-origin"]).toBe("*");
      // The route sets a 10-minute public cache.
      expect(headers["cache-control"] || "").toContain("max-age=600");

      const body: { [key: string]: unknown } = (await response.json()) as {
        [key: string]: unknown;
      };
      expect(typeof body).toBe("object");
      expect(body).not.toBeNull();

      const items: unknown = body[arrayKey];
      expect(Array.isArray(items)).toBe(true);
      // A blank data source would serialize as an empty array with a 200.
      expect((items as Array<unknown>).length).toBeGreaterThan(0);
    });
  }

  test("/data/pricing.json carries plans, the telemetry ingest price, and the feature matrix", async ({
    page,
  }: {
    page: Page;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return;
    }

    page.setDefaultNavigationTimeout(120000);

    const response: APIResponse = await page.request.get(
      endpointFor("/data/pricing.json"),
    );

    expect(response.status()).toBe(200);

    const headers: { [key: string]: string } = response.headers();
    expect(headers["content-type"] || "").toContain("application/json");
    expect(headers["access-control-allow-origin"]).toBe("*");
    expect(headers["cache-control"] || "").toContain("max-age=600");

    const body: {
      plans?: unknown;
      telemetryIngestPricePerGB?: unknown;
      featureMatrix?: unknown;
    } = (await response.json()) as {
      plans?: unknown;
      telemetryIngestPricePerGB?: unknown;
      featureMatrix?: unknown;
    };

    // The three documented top-level keys must all be present.
    expect(body.plans).toBeDefined();
    expect(body.featureMatrix).toBeDefined();
    // The per-GB telemetry price is a fixed, published string.
    expect(body.telemetryIngestPricePerGB).toBe("$0.10");
  });

  test("/data/compare/<slug> returns the competitor document for a known slug", async ({
    page,
  }: {
    page: Page;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return;
    }

    page.setDefaultNavigationTimeout(120000);

    // "pagerduty" is a flagship comparison the other Home specs already rely on.
    const response: APIResponse = await page.request.get(
      endpointFor("/data/compare/pagerduty"),
    );

    expect(response.status()).toBe(200);

    const headers: { [key: string]: string } = response.headers();
    expect(headers["content-type"] || "").toContain("application/json");
    expect(headers["access-control-allow-origin"]).toBe("*");

    const body: { productName?: unknown } = (await response.json()) as {
      productName?: unknown;
    };
    // The comparison document names the competitor it compares against.
    expect(typeof body.productName).toBe("string");
    expect((body.productName as string).length).toBeGreaterThan(0);
  });

  test("/data/compare/<slug> returns a JSON 404 for an unknown slug", async ({
    page,
  }: {
    page: Page;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return;
    }

    page.setDefaultNavigationTimeout(120000);

    const response: APIResponse = await page.request.get(
      endpointFor("/data/compare/definitely-not-a-real-competitor"),
    );

    // The route returns a structured 404 rather than an HTML error page.
    expect(response.status()).toBe(404);
    /*
     * Even the error path is CORS-open so agents see the 404 rather than a
     * cross-origin failure.
     */
    expect(response.headers()["access-control-allow-origin"]).toBe("*");

    const body: { error?: unknown } = (await response.json()) as {
      error?: unknown;
    };
    expect(body.error).toBe("Comparison not found");
  });
});
