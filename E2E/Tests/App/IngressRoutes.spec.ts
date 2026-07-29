import { BASE_URL } from "../../Config";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * Ingress routing smoke test.
 *
 * OneUptime serves every user-facing service behind one nginx ingress at a
 * distinct path prefix (/dashboard, /accounts, /status-page, /admin, ...).
 * A misconfigured ingress — a dropped location block, a service that failed
 * to register, a wrong upstream — surfaces as a 404 or 502 on one prefix
 * while the rest of the stack looks healthy, so a per-service test suite can
 * stay green while a whole product area is unreachable.
 *
 * This suite asserts that each core service prefix is reachable through the
 * ingress (a non-error response after following redirects). The set mirrors
 * the routes the deploy's own readiness gate (Tests/Scripts/status-check.sh)
 * blocks on before E2E runs, so every route here is expected to be serving by
 * the time this suite executes; the value is catching a regression that makes
 * one of them start returning a 4xx/5xx.
 */

const INGRESS_ROUTES: Array<string> = [
  "/", // App
  "/status", // App status probe
  "/status/ready", // App readiness probe
  "/dashboard", // Dashboard SPA
  "/accounts", // Accounts / auth SPA
  "/status-page", // Status Page app
  "/public-dashboard", // Public Dashboard app
  "/admin/env.js", // Admin Dashboard runtime config
];

test.describe("Core service routes are reachable through the ingress", () => {
  for (const route of INGRESS_ROUTES) {
    test(`${route} responds without a client/server error`, async ({
      page,
    }: {
      page: Page;
    }) => {
      page.setDefaultNavigationTimeout(120000); // 2 minutes

      const endpoint: string = URL.fromString(BASE_URL.toString())
        .addRoute(route)
        .toString();

      /*
       * Playwright's request context follows redirects by default, so this is
       * the status of the final response the ingress ultimately serves.
       */
      const response: APIResponse = await page.request.get(endpoint);

      /*
       * A healthy ingress route serves a non-error response (2xx/3xx). A 404
       * (missing location block) or 5xx (dead upstream) fails here.
       */
      expect(response.status()).toBeGreaterThanOrEqual(200);
      expect(response.status()).toBeLessThan(400);
    });
  }
});
