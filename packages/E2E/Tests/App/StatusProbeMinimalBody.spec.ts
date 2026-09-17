import { BASE_URL } from "../../Config";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * Exact-shape contract for the App service's status probes.
 *
 * The sibling suites assert the status code (HealthEndpoints), the
 * Content-Type (HealthEndpointContentType), and that the body *contains*
 * `status: "ok"` (StatusCheck, HealthEndpoints via toMatchObject). None of
 * them assert what the body must NOT contain.
 *
 * StatusAPI serves each of these routes with
 * `Response.sendJsonObjectResponse(req, res, { status: "ok" })` — a body of
 * exactly one key. That minimalism is a real contract worth pinning:
 *
 *   - A regression that started echoing request data, build metadata, or —
 *     worst — an error/stack field into a public, unauthenticated probe
 *     would be information disclosure. These endpoints sit in front of the
 *     ingress and answer anyone.
 *   - Probe traffic is high-frequency (k8s liveness/readiness on every
 *     pod); an accidentally bloated body is paid for on every request.
 *
 * So this suite asserts the body has *exactly* the `status` key and nothing
 * else. `toMatchObject` cannot catch an extra field; an exact key-set check
 * can.
 */

const STATUS_PROBE_ROUTES: Array<string> = [
  "/status",
  "/status/ready",
  "/status/live",
];

test.describe("App status probes return a minimal, single-key body", () => {
  for (const route of STATUS_PROBE_ROUTES) {
    test(`${route} body is exactly { status: "ok" } with no extra fields`, async ({
      page,
    }: {
      page: Page;
    }) => {
      page.setDefaultNavigationTimeout(120000); // 2 minutes

      const endpoint: string = URL.fromString(BASE_URL.toString())
        .addRoute(route)
        .toString();

      const response: APIResponse = await page.request.get(endpoint);

      // Success code, same as the sibling suites.
      expect(response.status()).toBeGreaterThanOrEqual(200);
      expect(response.status()).toBeLessThan(300);

      const body: unknown = await response.json();

      // Must be a plain JSON object, not an array or scalar.
      expect(typeof body).toBe("object");
      expect(body).not.toBeNull();
      expect(Array.isArray(body)).toBe(false);

      const record: Record<string, unknown> = body as Record<string, unknown>;

      // The value is "ok"...
      expect(record["status"]).toBe("ok");

      /*
       * ...and `status` is the ONLY key. This is the assertion the other
       * suites cannot make: no metadata, no echoed input, no error/stack
       * field leaked onto a public probe.
       */
      expect(Object.keys(record)).toEqual(["status"]);
    });
  }
});
