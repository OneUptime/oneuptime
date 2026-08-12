import { BASE_URL } from "../../Config";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * Content-Type contract for the App service's status/health endpoints.
 *
 * The sibling suites (HealthEndpoints, StatusCheck, AppNameEndpoint) assert the
 * status code and the parsed JSON body, but none of them assert the response
 * *header* the browser and tooling actually branch on. StatusAPI serves these
 * routes through Response.sendJsonObjectResponse / res.send(object), so Express
 * stamps `Content-Type: application/json`. A regression that started returning
 * an HTML error page, plain text, or a 500 whose body happened to embed "ok"
 * could still parse loosely elsewhere but would announce the wrong media type
 * here — which is exactly what this guards.
 */

const JSON_ROUTES: Array<string> = [
  "/status",
  "/status/ready",
  "/status/live",
  "/app-name",
];

test.describe("App service health endpoints advertise JSON", () => {
  for (const route of JSON_ROUTES) {
    test(`${route} responds with an application/json Content-Type`, async ({
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

      /*
       * The media type must be JSON (charset suffixes such as
       * "; charset=utf-8" are allowed).
       */
      const contentType: string = response.headers()["content-type"] || "";
      expect(contentType.toLowerCase()).toContain("application/json");

      // And the body must genuinely parse as JSON, not merely claim to.
      const body: unknown = await response.json();
      expect(typeof body).toBe("object");
      expect(body).not.toBeNull();
    });
  }
});
