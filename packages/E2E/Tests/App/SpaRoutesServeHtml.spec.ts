import { BASE_URL } from "../../Config";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * Ingress content-type smoke test for the single-page-app services.
 *
 * IngressRoutes.spec.ts asserts each core prefix is *reachable* (final status
 * < 400 after redirects), but a status-only check cannot tell an SPA's index
 * document apart from the wrong upstream answering on that prefix — a
 * misrouted location block that pointed /dashboard at a JSON API, or served a
 * bare 200 that is not the app shell, would still look "reachable".
 *
 * These routes all serve a browser-facing SPA, so the invariant that actually
 * matters is: the ingress returns an HTML document. Each route below is gated
 * to "serving" by the deploy's readiness check (Tests/Scripts/status-check.sh)
 * before E2E runs, so a failure here is a real content-type/upstream
 * regression, not a warm-up race.
 *
 * Playwright's request context follows redirects, so an unauthenticated
 * /dashboard that bounces to the accounts login still lands on an SPA shell —
 * the assertion holds across the redirect.
 */

const SPA_ROUTES: Array<string> = [
  "/dashboard", // Dashboard SPA
  "/accounts", // Accounts / auth SPA
  "/status-page", // Status Page app
  "/public-dashboard", // Public Dashboard app
];

test.describe("SPA service routes serve an HTML document through the ingress", () => {
  for (const route of SPA_ROUTES) {
    test(`${route} responds 2xx with an HTML content-type and document`, async ({
      page,
    }: {
      page: Page;
    }) => {
      page.setDefaultNavigationTimeout(120000); // 2 minutes

      const endpoint: string = URL.fromString(BASE_URL.toString())
        .addRoute(route)
        .toString();

      const response: APIResponse = await page.request.get(endpoint);

      // The final response (after any redirect) must be a success code.
      expect(response.status()).toBeGreaterThanOrEqual(200);
      expect(response.status()).toBeLessThan(300);

      // It must be served as HTML, not a JSON API or some other upstream.
      const contentType: string = response.headers()["content-type"] || "";
      expect(contentType.toLowerCase()).toContain("text/html");

      // And the body must actually be an HTML document, not an empty 200.
      const body: string = await response.text();
      expect(body.toLowerCase()).toMatch(/<!doctype html|<html/);
    });
  }
});
