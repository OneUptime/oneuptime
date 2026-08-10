import { BASE_URL } from "../../Config";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * Shallow health-endpoint checks for the App service, addressed through the
 * unconditional "/api" route.
 *
 * The sibling HealthEndpoints.spec.ts / HealthEndpointConsistency.spec.ts /
 * StatusCheck.spec.ts suites all probe the ROOT paths — /status, /status/ready
 * and /status/live. But nginx's catch-all `location /`
 * (Nginx/default.conf.template) proxies the root to the *Home* service when
 * BILLING_ENABLED=true (the SaaS CI stack, docker-compose.billing.yml) and only
 * to *App* otherwise. So in a billing deployment those root-path suites are
 * actually exercising Home's probes, and the App's own shallow /status,
 * /status/ready and /status/live handlers (StatusAPI in
 * Common/Server/API/StatusAPI.ts, wired in App/Index.ts) are never asserted
 * directly by any E2E test.
 *
 * This suite closes that gap by using the "/api" prefix, which — exactly as
 * DeepHealthEndpoints.spec.ts documents for the deep per-datastore routes — is
 * unconditional in nginx and always proxies to App. Common/Server/API/Index.ts
 * mounts StatusAPI at both `/${appName}` and `/`, and App/Index.ts sets
 * appName = "api", so /api/status, /api/status/ready and /api/status/live reach
 * the App's own shallow probes in BOTH deployment modes. A regression that
 * broke App's readiness/liveness contract (a changed body, a non-JSON error
 * page, a dropped route) would slip past the root-path suites in the billing
 * stack but is caught here.
 *
 * Robustness: the deploy's readiness gate (Tests/Scripts/status-check.sh)
 * blocks on /dashboard, which nginx proxies to App unconditionally, so by the
 * time this suite runs the App is already answering. A failure here is a real
 * contract regression, not a warm-up race.
 */

const APP_SHALLOW_HEALTH_ROUTES: Array<string> = [
  "/api/status", // App status
  "/api/status/ready", // App readiness probe
  "/api/status/live", // App liveness probe
];

const POLL_COUNT: number = 3;

test.describe("App shallow health endpoints (via /api) return well-formed JSON", () => {
  for (const route of APP_SHALLOW_HEALTH_ROUTES) {
    test(`${route} responds 200 with a stable { status: "ok" } JSON body`, async ({
      page,
    }: {
      page: Page;
    }) => {
      page.setDefaultNavigationTimeout(120000); // 2 minutes

      const endpoint: string = URL.fromString(BASE_URL.toString())
        .addRoute(route)
        .toString();

      const bodies: Array<string> = [];

      for (let attempt: number = 0; attempt < POLL_COUNT; attempt++) {
        const response: APIResponse = await page.request.get(endpoint);

        // App probe must answer with a success status code.
        expect(response.status()).toBeGreaterThanOrEqual(200);
        expect(response.status()).toBeLessThan(300);

        /*
         * Served as JSON, not an HTML error page: a 500 page that happened to
         * embed "ok" would not carry an application/json content-type and would
         * not parse below.
         */
        const contentType: string | null = response.headers()["content-type"]
          ? response.headers()["content-type"]!
          : null;
        expect(contentType).not.toBeNull();
        expect(contentType!.toLowerCase()).toContain("application/json");

        // Body parses as JSON and carries exactly status: "ok".
        const body: unknown = await response.json();
        expect(body).toMatchObject({ status: "ok" });

        bodies.push(JSON.stringify(body));
      }

      // The probe must not flap between polls — the deploy healthchecks poll it.
      const distinctBodies: Set<string> = new Set(bodies);
      expect(distinctBodies.size).toBe(1);
    });
  }
});
