import { BASE_URL } from "../../Config";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * Per-datastore deep health checks for the App service.
 *
 * StatusAPI (Common/Server/API/StatusAPI.ts) mounts three checks BEYOND the
 * shallow /status, /status/ready and /status/live probes that the sibling
 * suites already cover:
 *
 *   - /status/database          -> App/Index.ts wires this to a Postgres check
 *   - /status/analytics-database-> ... to a ClickHouse check
 *   - /status/global-cache      -> ... to a Redis check
 *
 * These are the only endpoints that prove the App can actually reach each
 * individual backing store. The shallow readiness probe the deploy gates on
 * checks all three at once, so a regression that broke the *routing* of one
 * deep endpoint (a dropped branch, a renamed check, an option no longer passed
 * to StatusAPI.init) would leave the shallow probe green while the operator's
 * per-store health view silently started 400/500-ing. No E2E suite guards them
 * today; this one does.
 *
 * Robustness: the deploy's readiness gate (Tests/Scripts/status-check.sh) blocks
 * on /status/ready, whose check verifies Postgres, ClickHouse AND Redis with
 * retries, so by the time this suite runs every backing store the three deep
 * endpoints probe is already confirmed reachable. A failure here is therefore a
 * real routing/contract regression, not a warm-up race.
 */

const DEEP_HEALTH_ROUTES: Array<string> = [
  "/status/database", // Postgres reachability
  "/status/analytics-database", // ClickHouse reachability
  "/status/global-cache", // Redis reachability
];

test.describe("App per-datastore deep health endpoints return well-formed JSON", () => {
  for (const route of DEEP_HEALTH_ROUTES) {
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

      // A reachable datastore must answer with a success code.
      expect(response.status()).toBeGreaterThanOrEqual(200);
      expect(response.status()).toBeLessThan(300);

      /*
       * The endpoint is served as JSON, not an HTML error page: a 500 error
       * page that happened to embed "ok" would not parse here.
       */
      const contentType: string | null = response.headers()["content-type"]
        ? response.headers()["content-type"]!
        : null;
      expect(contentType).not.toBeNull();
      expect(contentType!.toLowerCase()).toContain("application/json");

      // Body parses as JSON and carries exactly status: "ok".
      const body: unknown = await response.json();
      expect(body).toMatchObject({ status: "ok" });
    });
  }
});
