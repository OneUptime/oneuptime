import { BASE_URL } from "../../Config";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * HEAD-request contract for the App service's status probes.
 *
 * StatusAPI mounts these routes with router.get(...). Express serves HEAD for
 * every GET route automatically: it runs the same handler, computes the same
 * headers, and strips the body at the HTTP layer. Load balancers, CDNs, and
 * many uptime checks issue HEAD rather than GET precisely because it avoids
 * transferring a body — so the probe answering HEAD is a real part of its
 * contract, and one no existing suite covers (StatusEndpointContract,
 * StatusCheck, StatusProbeMinimalBody all use GET).
 *
 * A regression that mounted these on a method-specific handler that did not
 * fall through to HEAD (e.g. a custom router, or an explicit `if method ===
 * GET`) would 404/405 a HEAD probe and silently take pods out of rotation
 * behind a HEAD-based load balancer, while every GET-based suite stayed green.
 *
 * This pins the two defining HEAD guarantees:
 *   - HEAD returns the SAME status code as GET for the route, and
 *   - HEAD returns an empty body.
 */

const STATUS_ROUTES: Array<string> = [
  "/status",
  "/status/ready",
  "/status/live",
];

test.describe("App service status probe HEAD contract", () => {
  for (const route of STATUS_ROUTES) {
    test(`HEAD ${route} mirrors GET status and returns an empty body`, async ({
      page,
    }: {
      page: Page;
    }) => {
      page.setDefaultNavigationTimeout(120000); // 2 minutes

      const endpoint: string = URL.fromString(BASE_URL.toString())
        .addRoute(route)
        .toString();

      const getResponse: APIResponse = await page.request.get(endpoint);
      const headResponse: APIResponse = await page.request.head(endpoint);

      /*
       * HEAD must route to the same handler as GET and therefore report the
       * same status code — not a 404/405 from an unhandled method.
       */
      expect(headResponse.status()).toBe(getResponse.status());

      // A HEAD response never carries a body, by definition.
      const headBody: Buffer = await headResponse.body();
      expect(headBody.length).toBe(0);
    });
  }
});
