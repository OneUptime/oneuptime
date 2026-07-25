import { BASE_URL } from "../../Config";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * Consistency checks for the App service health endpoints.
 *
 * HealthEndpoints.spec.ts proves each of /status, /status/ready and
 * /status/live responds 200 with a `{ status: "ok" }` JSON body at a single
 * point in time. This suite adds the property those single-shot checks can't
 * observe: the health probes are IDEMPOTENT and MUTUALLY CONSISTENT. Kubernetes
 * (and the docker-compose healthchecks) poll /status/ready and /status/live on
 * a tight loop, so a probe that flaps — 200 then 503, or a body that drifts
 * between calls — would silently cause restart storms in production while every
 * single-request test stays green. Polling each endpoint several times and
 * asserting a stable, identical result is what catches that class of flake.
 */

const HEALTH_ROUTES: Array<string> = [
  "/status",
  "/status/ready",
  "/status/live",
];

const POLL_COUNT: number = 5;

test.describe("App health endpoints are idempotent and consistent", () => {
  for (const route of HEALTH_ROUTES) {
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

        // Every poll must be a success code.
        expect(response.status()).toBeGreaterThanOrEqual(200);
        expect(response.status()).toBeLessThan(300);

        // Every poll must parse as JSON and carry status: "ok".
        const body: unknown = await response.json();
        expect(body).toMatchObject({ status: "ok" });

        bodies.push(JSON.stringify(body));
      }

      // The body must not drift between polls — a flapping probe is a bug.
      const distinctBodies: Set<string> = new Set(bodies);
      expect(distinctBodies.size).toBe(1);
    });
  }

  test("liveness and readiness agree while the service is healthy", async ({
    page,
  }: {
    page: Page;
  }) => {
    page.setDefaultNavigationTimeout(120000); // 2 minutes

    const liveEndpoint: string = URL.fromString(BASE_URL.toString())
      .addRoute("/status/live")
      .toString();
    const readyEndpoint: string = URL.fromString(BASE_URL.toString())
      .addRoute("/status/ready")
      .toString();

    const liveResponse: APIResponse = await page.request.get(liveEndpoint);
    const readyResponse: APIResponse = await page.request.get(readyEndpoint);

    const liveBody: unknown = await liveResponse.json();
    const readyBody: unknown = await readyResponse.json();

    /*
     * A live-but-not-ready service is a valid transient state, but a healthy
     * service must report ok on both probes.
     */
    expect(liveBody).toMatchObject({ status: "ok" });
    expect(readyBody).toMatchObject({ status: "ok" });
  });
});
