import { BASE_URL } from "../../Config";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * Idempotency / consistency checks for the App's per-datastore DEEP health
 * endpoints.
 *
 * DeepHealthEndpoints.spec.ts proves each of /api/status/database,
 * /api/status/analytics-database and /api/status/global-cache answers 200 with
 * a `{ status: "ok" }` JSON body at a single point in time. HealthEndpoint-
 * Consistency.spec.ts adds the "does not flap" property for the SHALLOW probes
 * (/status, /status/ready, /status/live) — but nothing adds it for the deep
 * per-store probes, and those are exactly the ones an operator's dashboard and
 * any store-level alerting poll on a loop. A deep probe that returned 200 then
 * 503 (a connection pool that intermittently can't hand out a Postgres/Click-
 * House/Redis connection), or whose body drifted between calls, would pass the
 * single-shot deep suite and still drive restart storms or alert noise in
 * production.
 *
 * Why "/api/status/*" and not the root path: nginx's catch-all `location /`
 * proxies to the Home service when BILLING_ENABLED=true (the SaaS CI stack) and
 * to App otherwise, and Home only wires liveCheck/readyCheck into StatusAPI —
 * so the three deep routes answer 400 "check not implemented" at the root in a
 * billing deployment. `location /api` is unconditional and always proxies to
 * App (appName = "api"), so /api/status/* reaches the App's own deep checks in
 * both deployment modes. This mirrors the reasoning in DeepHealthEndpoints.spec
 * .ts, which is why every route here is already known to be serving by the time
 * this suite runs; the value added is proving each one is STABLE across polls.
 */

const DEEP_HEALTH_ROUTES: Array<string> = [
  "/api/status/database", // Postgres reachability
  "/api/status/analytics-database", // ClickHouse reachability
  "/api/status/global-cache", // Redis reachability
];

const POLL_COUNT: number = 5;

test.describe("App deep health endpoints are idempotent and consistent", () => {
  for (const route of DEEP_HEALTH_ROUTES) {
    test(`${route} returns a stable { status: "ok" } across ${POLL_COUNT} polls`, async ({
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

        // Every poll must be a success code — a single 5xx is a flap.
        expect(response.status()).toBeGreaterThanOrEqual(200);
        expect(response.status()).toBeLessThan(300);

        // Every poll must be machine-readable JSON, never an HTML error page.
        const contentType: string | null = response.headers()["content-type"]
          ? response.headers()["content-type"]!
          : null;
        expect(contentType).not.toBeNull();
        expect(contentType!.toLowerCase()).toContain("application/json");

        // Every poll must parse as JSON and carry status: "ok".
        const body: unknown = await response.json();
        expect(body).toMatchObject({ status: "ok" });

        bodies.push(JSON.stringify(body));
      }

      // The body must not drift between polls — a flapping deep probe is a bug.
      const distinctBodies: Set<string> = new Set(bodies);
      expect(distinctBodies.size).toBe(1);
    });
  }
});
