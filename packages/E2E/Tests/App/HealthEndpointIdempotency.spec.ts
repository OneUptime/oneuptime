import { BASE_URL } from "../../Config";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * Idempotency and unauthenticated-access contract for the App service's
 * health endpoints.
 *
 * The sibling suites (HealthEndpoints, HealthEndpointContentType, StatusCheck)
 * each assert a single GET returns a 2xx JSON body of `{ status: "ok" }`. This
 * suite pins two further properties that liveness/readiness probes and load
 * balancers actually depend on:
 *
 *   1. The endpoints are side-effect free and stable: two back-to-back GETs
 *      return the same 2xx status and the same `{ status: "ok" }` body. A
 *      regression that made health stateful (e.g. flipping to degraded on the
 *      second poll, or caching a stale error) would break here while a
 *      single-request suite stayed green.
 *
 *   2. The endpoints are reachable without authentication: a health probe
 *      carries no session cookie, so the response must never be an auth
 *      redirect (3xx) or a 401/403. Kubernetes and uptime checks hit these
 *      routes anonymously.
 *
 * Both properties are already implied by the current passing behavior, so this
 * suite only tightens the guarantee; it does not assume anything new about the
 * deployment.
 */

const HEALTH_ROUTES: Array<string> = [
  "/status",
  "/status/ready",
  "/status/live",
];

test.describe("App service health endpoints are idempotent and unauthenticated", () => {
  for (const route of HEALTH_ROUTES) {
    test(`${route} returns an identical { status: "ok" } body on repeated GETs`, async ({
      page,
    }: {
      page: Page;
    }) => {
      page.setDefaultNavigationTimeout(120000); // 2 minutes

      const endpoint: string = URL.fromString(BASE_URL.toString())
        .addRoute(route)
        .toString();

      const first: APIResponse = await page.request.get(endpoint);
      const second: APIResponse = await page.request.get(endpoint);

      // Both responses are success codes.
      expect(first.status()).toBeGreaterThanOrEqual(200);
      expect(first.status()).toBeLessThan(300);
      expect(second.status()).toBeGreaterThanOrEqual(200);
      expect(second.status()).toBeLessThan(300);

      // The status code is stable across the two calls.
      expect(second.status()).toBe(first.status());

      // Both bodies parse as JSON and carry status: "ok".
      const firstBody: unknown = await first.json();
      const secondBody: unknown = await second.json();
      expect(firstBody).toMatchObject({ status: "ok" });
      expect(secondBody).toMatchObject({ status: "ok" });

      // And the two bodies are identical.
      expect(secondBody).toEqual(firstBody);
    });

    test(`${route} is reachable without authentication`, async ({
      page,
    }: {
      page: Page;
    }) => {
      page.setDefaultNavigationTimeout(120000); // 2 minutes

      const endpoint: string = URL.fromString(BASE_URL.toString())
        .addRoute(route)
        .toString();

      /*
       * maxRedirects: 0 makes an auth redirect observable as a 3xx status
       * instead of being transparently followed.
       */
      const response: APIResponse = await page.request.get(endpoint, {
        maxRedirects: 0,
      });

      // A health probe must not be redirected to a login page.
      expect(response.status()).toBeLessThan(300);

      // Nor rejected as unauthorized or forbidden.
      expect(response.status()).not.toBe(401);
      expect(response.status()).not.toBe(403);
    });
  }
});
