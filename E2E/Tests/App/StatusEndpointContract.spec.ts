import { BASE_URL } from "../../Config";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * HTTP-level contract for the App service's status probes.
 *
 * StatusCheck.spec.ts navigates a browser to these routes and asserts the
 * rendered page CONTAINS {"status":"ok"}. That proves the body but says nothing
 * about the two things a Kubernetes probe and any programmatic caller actually
 * key off: the HTTP status code and the Content-Type. A route that answered 503
 * (or served an HTML error page that happened to embed the string) would pass
 * the existing suite and still take the pod out of rotation.
 *
 * These endpoints are mounted unconditionally by StatusAPI and, once the stack
 * is up, always resolve, so this issues real API requests (not browser
 * navigations) and pins:
 *
 *   - a 200 status code,
 *   - a JSON content-type, and
 *   - a body that is exactly { status: "ok" }.
 */

const STATUS_ROUTES: Array<string> = [
  "/status",
  "/status/ready",
  "/status/live",
];

test.describe("App service status probe contract", () => {
  for (const route of STATUS_ROUTES) {
    test(`${route} returns 200 JSON { status: "ok" }`, async ({
      page,
    }: {
      page: Page;
    }) => {
      page.setDefaultNavigationTimeout(120000); // 2 minutes

      const endpoint: string = URL.fromString(BASE_URL.toString())
        .addRoute(route)
        .toString();

      const response: APIResponse = await page.request.get(endpoint);

      // A healthy probe is specifically 200, not merely any 2xx.
      expect(response.status()).toBe(200);

      // Must be machine-readable JSON, never an HTML error page.
      expect(response.headers()["content-type"]).toContain("application/json");

      const body: unknown = await response.json();
      expect(body).toEqual({ status: "ok" });
    });
  }
});
