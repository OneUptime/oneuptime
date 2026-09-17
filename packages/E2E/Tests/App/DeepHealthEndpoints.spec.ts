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
 * Why the "/api" prefix instead of the root path: nginx's catch-all
 * `location /` (Nginx/default.conf.template) proxies to the *Home* service when
 * BILLING_ENABLED=true (the SaaS CI stack, docker-compose.billing.yml) and to
 * the *App* service otherwise (the self-hosted stack). Home only passes
 * liveCheck/readyCheck to StatusAPI.init, so the three deep routes answer 400
 * "check not implemented" there. `location /api` is unconditional and always
 * proxies to App, and Common/Server/API/Index.ts mounts StatusAPI at both
 * `/${appName}` and `/` with App/Index.ts setting appName = "api" — so
 * /api/status/* reaches the App's own deep checks in both deployment modes.
 *
 * Robustness: App/Index.ts awaits PostgresAppInstance.connect(), Redis.connect()
 * and ClickhouseAppInstance.connect() BEFORE it calls App.init(), so the App
 * serves no route at all until all three backing stores are up. The deploy's
 * readiness gate (Tests/Scripts/status-check.sh) blocks on /dashboard, which
 * nginx proxies to App unconditionally, so by the time this suite runs the App
 * is answering and therefore every store it probes is already connected. A
 * failure here is a real routing/contract regression, not a warm-up race.
 *
 * (Note the gate's own "App (Ready Check)" row probes the ROOT /status/ready,
 * which is Home in a billing deployment — and Home's check disables the
 * Postgres/ClickHouse/Redis probes — so that row is not what makes this suite
 * safe.)
 */

const DEEP_HEALTH_ROUTES: Array<string> = [
  "/api/status/database", // Postgres reachability
  "/api/status/analytics-database", // ClickHouse reachability
  "/api/status/global-cache", // Redis reachability
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
