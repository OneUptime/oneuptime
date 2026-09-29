import { BASE_URL } from "../../Config";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * Deployment contract for the network topology endpoint's front door.
 *
 * POST /api/network-device/topology answers with the whole of a project's
 * network — every device, every link between them, the sites they sit in and
 * the interfaces that join them. Inside the handler, several of those reads
 * are deliberately made as ROOT and unfiltered: the map is one picture of the
 * project, so a viewer without ReadNetworkDeviceRole must not see a
 * differently-shaped map from everyone else. That is the right call for a
 * signed-in member and precisely why the tenant check ahead of it is
 * load-bearing — those root reads are what an unauthenticated caller would be
 * reaching if it ever fell through.
 *
 * Unit tests cover the handler with the middleware mocked out, which is the
 * one arrangement that cannot prove the guard is actually mounted in front of
 * the route in a real deployment. A router registered without
 * UserMiddleware.getUserMiddleware, or nginx routing past it, would leave
 * every unit test green.
 *
 * Both cases below are deterministic and need no seeded data: the endpoint is
 * mounted unconditionally by the api feature set, and neither a missing token
 * nor a malformed one depends on anything in the database.
 */

const TOPOLOGY_ENDPOINT: string = URL.fromString(BASE_URL.toString())
  .addRoute("/api/network-device/topology")
  .toString();

/*
 * The graph itself. Asserted absent rather than just checking the status
 * code, so a handler that answered "200 with an empty map" — which is a leak
 * of the shape of the API, and one refactor away from being a leak of the
 * map — cannot pass by returning an error-ish body with a success code.
 */
const TOPOLOGY_PAYLOAD_KEYS: Array<string> = ["nodes", "edges"];

test.describe("network topology API rejects unauthenticated callers", () => {
  test("a request with no credentials is refused, and carries no map", async ({
    page,
  }: {
    page: Page;
  }): Promise<void> => {
    page.setDefaultNavigationTimeout(120000); // 2 minutes

    const response: APIResponse = await page.request.post(TOPOLOGY_ENDPOINT, {
      data: {},
    });

    /*
     * With no access token the request is treated as public, so it carries no
     * tenant and the handler refuses it before reading anything. The exact
     * code is the handler's business; what matters here is that it is a
     * client error and never a success.
     */
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).toBeLessThan(500);

    const body: string = await response.text();

    for (const key of TOPOLOGY_PAYLOAD_KEYS) {
      expect(body).not.toContain(`"${key}"`);
    }
  });

  /*
   * A token that does not decode is a different path from no token at all: it
   * is answered 401 specifically, so a client knows to refresh rather than to
   * re-authenticate from scratch. Worth pinning as its own case — a change
   * that collapsed it into the 400 above would send clients into a sign-in
   * loop on nothing worse than an expired token.
   */
  test("a malformed access token is answered 401, not a map", async ({
    page,
  }: {
    page: Page;
  }): Promise<void> => {
    page.setDefaultNavigationTimeout(120000); // 2 minutes

    const response: APIResponse = await page.request.post(TOPOLOGY_ENDPOINT, {
      data: {},
      headers: {
        /*
         * The middleware only treats an Authorization header as a token when
         * it is the "Bearer <token>" form the mobile app sends; anything else
         * is ignored and the caller falls through to the public path above.
         * So the scheme is spelled out here on purpose - without it this test
         * would silently be a second copy of the no-credentials case.
         */
        authorization: "Bearer not-a-real-token",
      },
    });

    expect(response.status()).toBe(401);

    const body: string = await response.text();

    for (const key of TOPOLOGY_PAYLOAD_KEYS) {
      expect(body).not.toContain(`"${key}"`);
    }
  });
});
