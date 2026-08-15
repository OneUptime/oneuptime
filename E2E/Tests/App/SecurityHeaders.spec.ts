import { BASE_URL } from "../../Config";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * Security-header contract for the ingress.
 *
 * The nginx ingress (Nginx/default.conf.template) hardens the browser-facing
 * SPA routes by attaching a fixed set of security response headers with the
 * `always` flag so they are emitted regardless of the upstream status code:
 *
 *   location /dashboard {
 *     add_header X-Content-Type-Options "nosniff" always;
 *     add_header X-Frame-Options       "DENY"    always;
 *     add_header X-XSS-Protection      "1; mode=block" always;
 *     add_header Cache-Control "no-cache, no-store, must-revalidate" always;
 *   }
 *
 * These headers are what stop the authenticated Dashboard from being framed
 * (clickjacking), MIME-sniffed into executing an uploaded payload, or cached by
 * an intermediary. They live only in the ingress config, so a refactor of that
 * file — a dropped `add_header`, a mistyped location, a header moved to a block
 * that no longer applies — silently strips the protection while every existing
 * suite (which only asserts status codes and bodies) stays green. No other E2E
 * suite inspects response headers, so this one guards them.
 *
 * /dashboard is proxied to the App service unconditionally in both the
 * self-hosted and billing deployment modes and is one of the routes the deploy's
 * own readiness gate (Tests/Scripts/status-check.sh) blocks on, so it is always
 * serving by the time this suite runs.
 */

const DASHBOARD_ROUTE: string = "/dashboard";

interface ExpectedHeader {
  name: string;
  // Substring the header value must contain (case-insensitive).
  contains: string;
}

const EXPECTED_HEADERS: Array<ExpectedHeader> = [
  { name: "x-content-type-options", contains: "nosniff" },
  { name: "x-frame-options", contains: "DENY" },
  { name: "x-xss-protection", contains: "1; mode=block" },
  { name: "cache-control", contains: "no-store" },
];

test.describe("Ingress security headers on browser-facing routes", () => {
  test(`${DASHBOARD_ROUTE} is served with hardening security headers`, async ({
    page,
  }: {
    page: Page;
  }) => {
    page.setDefaultNavigationTimeout(120000); // 2 minutes

    const endpoint: string = URL.fromString(BASE_URL.toString())
      .addRoute(DASHBOARD_ROUTE)
      .toString();

    const response: APIResponse = await page.request.get(endpoint);

    // The route must resolve (2xx/3xx), not error out.
    expect(response.status()).toBeGreaterThanOrEqual(200);
    expect(response.status()).toBeLessThan(400);

    const headers: { [key: string]: string } = response.headers();

    for (const expected of EXPECTED_HEADERS) {
      const actual: string | undefined = headers[expected.name];

      // The header must be present at all — a dropped add_header fails here.
      expect(
        actual,
        `expected response header "${expected.name}" to be present`,
      ).toBeTruthy();

      // ...and carry the hardening value the ingress config pins.
      expect(
        actual!.toLowerCase(),
        `expected "${expected.name}" to contain "${expected.contains}"`,
      ).toContain(expected.contains.toLowerCase());
    }
  });

  test(`${DASHBOARD_ROUTE} must never advertise a sniffable content type`, async ({
    page,
  }: {
    page: Page;
  }) => {
    page.setDefaultNavigationTimeout(120000); // 2 minutes

    const endpoint: string = URL.fromString(BASE_URL.toString())
      .addRoute(DASHBOARD_ROUTE)
      .toString();

    const response: APIResponse = await page.request.get(endpoint);

    /*
     * nosniff is only meaningful alongside a declared content type; a route that
     * dropped its Content-Type entirely would let a browser sniff regardless of
     * the nosniff directive.
     */
    const contentType: string | undefined = response.headers()["content-type"];
    expect(contentType).toBeTruthy();
  });
});
