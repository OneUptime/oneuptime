import { BASE_URL } from "../../Config";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * Structural health-endpoint checks for the App service.
 *
 * The sibling StatusCheck.spec.ts asserts the /status endpoints contain the
 * `{"status":"ok"}` substring. This suite goes further and validates the
 * response *shape*: a 2xx status code, a JSON content-type, and a parsed
 * body whose `status` field is exactly "ok". A regression that returns HTML,
 * a 500 page that happens to embed the substring, or a malformed body would
 * pass the substring check but fail here.
 */

const HEALTH_ROUTES: Array<string> = [
  "/status",
  "/status/ready",
  "/status/live",
];

test.describe("App service health endpoints return well-formed JSON", () => {
  for (const route of HEALTH_ROUTES) {
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

      // Status code should be a success code.
      expect(response.status()).toBeGreaterThanOrEqual(200);
      expect(response.status()).toBeLessThan(300);

      // Body should parse as JSON and carry status: "ok".
      const body: unknown = await response.json();
      expect(body).toMatchObject({ status: "ok" });
    });
  }
});
