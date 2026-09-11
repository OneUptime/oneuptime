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
 * The same set is asserted on /accounts and /admin, not just /dashboard. Each
 * location block carries its own copy of these headers — add_header inherits
 * only DOWN a level in nginx, never sideways between sibling locations, and
 * this server block declares none at the server level — so "the Dashboard is
 * protected" says nothing about the sign-in page or the admin console. They
 * are, if anything, the more attractive targets: /accounts is where a password
 * is typed, and /admin acts instance-wide.
 *
 * Nginx/Tests/NginxConfig.test.js pins the same split at the config level,
 * including the deliberate other half of it — /status-page and
 * /public-dashboard are meant to be embedded in customers' pages and must NOT
 * send DENY. This suite is the end-to-end half: it proves the rendered,
 * running ingress actually emits what the template says.
 *
 * All three routes are proxied to the App service unconditionally in both the
 * self-hosted and billing deployment modes; /dashboard is one of the routes the
 * deploy's own readiness gate (Tests/Scripts/status-check.sh) blocks on, and
 * the Accounts and AdminDashboard suites already load /accounts and /admin, so
 * all three are serving by the time this suite runs.
 */

const HARDENED_ROUTES: Array<string> = ["/dashboard", "/accounts", "/admin"];

/*
 * The deliberate other half. These two are embedded in customers' own pages,
 * so DENY here is a product regression rather than a hardening win — and it is
 * the kind of regression a well-meaning "add the header everywhere" change
 * introduces. IngressRoutes.spec.ts already proves both serve a non-error
 * response in this environment.
 */
const EMBEDDABLE_ROUTES: Array<string> = ["/status-page", "/public-dashboard"];

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

/*
 * The App container can still be warming up when this suite starts, and the
 * ingress answers that with a 502/504 of its own — which carries none of the
 * upstream's headers and would read as a stripped header rather than as a
 * not-yet-ready backend. Retry those two, and only those two.
 */
const GATEWAY_STATUSES: Array<number> = [502, 504];
const MAX_ATTEMPTS: number = 5;
const RETRY_DELAY_MS: number = 5000;

type FetchRoute = (page: Page, route: string) => Promise<APIResponse>;

const fetchRoute: FetchRoute = async (
  page: Page,
  route: string,
): Promise<APIResponse> => {
  const endpoint: string = URL.fromString(BASE_URL.toString())
    .addRoute(route)
    .toString();

  let response: APIResponse = await page.request.get(endpoint);

  for (
    let attempt: number = 1;
    attempt < MAX_ATTEMPTS && GATEWAY_STATUSES.includes(response.status());
    attempt++
  ) {
    await page.waitForTimeout(RETRY_DELAY_MS);
    response = await page.request.get(endpoint);
  }

  return response;
};

test.describe("Ingress security headers on browser-facing routes", () => {
  for (const route of HARDENED_ROUTES) {
    test(`${route} is served with hardening security headers`, async ({
      page,
    }: {
      page: Page;
    }) => {
      page.setDefaultNavigationTimeout(120000); // 2 minutes

      const response: APIResponse = await fetchRoute(page, route);

      // The route must resolve (2xx/3xx), not error out.
      expect(response.status()).toBeGreaterThanOrEqual(200);
      expect(response.status()).toBeLessThan(400);

      const headers: { [key: string]: string } = response.headers();

      for (const expected of EXPECTED_HEADERS) {
        const actual: string | undefined = headers[expected.name];

        // The header must be present at all — a dropped add_header fails here.
        expect(
          actual,
          `expected response header "${expected.name}" on ${route} to be present`,
        ).toBeTruthy();

        // ...and carry the hardening value the ingress config pins.
        expect(
          actual!.toLowerCase(),
          `expected "${expected.name}" on ${route} to contain "${expected.contains}"`,
        ).toContain(expected.contains.toLowerCase());
      }
    });

    test(`${route} must never advertise a sniffable content type`, async ({
      page,
    }: {
      page: Page;
    }) => {
      page.setDefaultNavigationTimeout(120000); // 2 minutes

      const response: APIResponse = await fetchRoute(page, route);

      /*
       * nosniff is only meaningful alongside a declared content type; a route that
       * dropped its Content-Type entirely would let a browser sniff regardless of
       * the nosniff directive.
       */
      const contentType: string | undefined =
        response.headers()["content-type"];
      expect(contentType).toBeTruthy();
    });
  }

  for (const route of EMBEDDABLE_ROUTES) {
    test(`${route} stays embeddable`, async ({ page }: { page: Page }) => {
      page.setDefaultNavigationTimeout(120000); // 2 minutes

      const response: APIResponse = await fetchRoute(page, route);

      expect(response.status()).toBeGreaterThanOrEqual(200);
      expect(response.status()).toBeLessThan(400);

      expect(
        response.headers()["x-frame-options"],
        `${route} is meant to be embedded in a customer's own page; X-Frame-Options here breaks that`,
      ).toBeUndefined();
    });

    test(`${route} still refuses to be MIME-sniffed`, async ({
      page,
    }: {
      page: Page;
    }) => {
      // Embeddable is not the same as unhardened.
      page.setDefaultNavigationTimeout(120000); // 2 minutes

      const response: APIResponse = await fetchRoute(page, route);

      expect(response.headers()["x-content-type-options"]).toContain("nosniff");
    });
  }
});
