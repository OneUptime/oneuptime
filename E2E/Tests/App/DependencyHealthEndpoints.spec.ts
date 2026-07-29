import { BASE_URL } from "../../Config";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * Dependency health-endpoint checks for the App service.
 *
 * StatusAPI (Common/Server/API/StatusAPI.ts) mounts three deeper readiness
 * probes in addition to the generic /status, /status/ready and /status/live
 * that the sibling suites already cover:
 *
 *   - /status/database           — Postgres reachable
 *   - /status/analytics-database — ClickHouse reachable
 *   - /status/global-cache       — Redis reachable
 *
 * The App service registers all three checks (App/Index.ts), and each returns
 * `{ status: "ok" }` only when the backing store actually answers — a probe
 * that threw would return an error status instead. No other E2E suite exercises
 * these routes, yet they are exactly what a deployment's readiness gating and
 * on-call dashboards poll to decide whether App can serve traffic. This suite
 * guards their contract: a 2xx code and a parsed JSON body of `{ status: "ok" }`.
 */

const DEPENDENCY_HEALTH_ROUTES: Array<string> = [
  "/status/database",
  "/status/analytics-database",
  "/status/global-cache",
];

test.describe("App service dependency health endpoints", () => {
  for (const route of DEPENDENCY_HEALTH_ROUTES) {
    test(`${route} responds 200 with { status: "ok" } JSON`, async ({
      page,
    }: {
      page: Page;
    }) => {
      page.setDefaultNavigationTimeout(120000); // 2 minutes

      const endpoint: string = URL.fromString(BASE_URL.toString())
        .addRoute(route)
        .toString();

      const response: APIResponse = await page.request.get(endpoint);

      // A healthy backing store yields a success status code.
      expect(response.status()).toBeGreaterThanOrEqual(200);
      expect(response.status()).toBeLessThan(300);

      // Body should parse as JSON and carry status: "ok".
      const body: unknown = await response.json();
      expect(body).toMatchObject({ status: "ok" });
    });
  }
});
