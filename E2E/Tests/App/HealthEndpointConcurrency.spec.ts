import { BASE_URL } from "../../Config";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * Concurrency check for the App service health probes.
 *
 * HealthEndpoints.spec.ts and HealthEndpointConsistency.spec.ts both call the
 * probes SEQUENTIALLY. But StatusAPI wraps /status/ready and /status/live in a
 * TTL cache plus a single-flight guard (StatusAPI.runCachedCheck): the first
 * request on a cache miss runs the real check while every concurrent caller
 * attaches to the SAME in-flight promise instead of starting its own. That
 * shared-promise path is only reachable when several requests land at once, so
 * no sequential suite exercises it. A regression there — the single-flight map
 * leaking a rejected promise to unrelated callers, or the cache handing back a
 * torn result — would surface as some requests in a concurrent burst failing
 * while others succeed.
 *
 * This suite fires a burst of simultaneous requests at each cached probe and
 * asserts EVERY response in the burst is a well-formed 2xx `{ status: "ok" }`.
 * On a healthy stack that is always true; the value is that it fans out
 * concurrently, so the single-flight/cache coalescing is on the hot path.
 */

const CACHED_HEALTH_ROUTES: Array<string> = ["/status/ready", "/status/live"];

const BURST_SIZE: number = 12;

test.describe("App health probes stay consistent under concurrent load", () => {
  for (const route of CACHED_HEALTH_ROUTES) {
    test(`${route} answers ${BURST_SIZE} simultaneous requests all 200 { status: "ok" }`, async ({
      page,
    }: {
      page: Page;
    }) => {
      page.setDefaultNavigationTimeout(120000); // 2 minutes

      const endpoint: string = URL.fromString(BASE_URL.toString())
        .addRoute(route)
        .toString();

      /*
       * Fire the whole burst at once so the requests race into the
       * single-flight guard together rather than one after another.
       */
      const responses: Array<APIResponse> = await Promise.all(
        Array.from({ length: BURST_SIZE }, () => {
          return page.request.get(endpoint);
        }),
      );

      const bodies: Array<string> = [];

      for (const response of responses) {
        // Every response in the burst must be a success code.
        expect(response.status()).toBeGreaterThanOrEqual(200);
        expect(response.status()).toBeLessThan(300);

        /*
         * Every response must parse as JSON and carry status: "ok" — a torn
         * or HTML error body fails here.
         */
        const body: unknown = await response.json();
        expect(body).toMatchObject({ status: "ok" });

        bodies.push(JSON.stringify(body));
      }

      /*
       * The coalesced responses must be identical to one another — the cache
       * must not hand different callers different bodies within one window.
       */
      const distinctBodies: Set<string> = new Set(bodies);
      expect(distinctBodies.size).toBe(1);
    });
  }

  test("ready and live bursts interleave without cross-contaminating results", async ({
    page,
  }: {
    page: Page;
  }) => {
    page.setDefaultNavigationTimeout(120000); // 2 minutes

    const readyEndpoint: string = URL.fromString(BASE_URL.toString())
      .addRoute("/status/ready")
      .toString();
    const liveEndpoint: string = URL.fromString(BASE_URL.toString())
      .addRoute("/status/live")
      .toString();

    /*
     * ready and live are DISTINCT cache keys. Interleaving their bursts checks
     * that the single-flight map keys checks correctly — a key collision would
     * let one probe's result leak into the other.
     */
    const mixed: Array<{ kind: "ready" | "live"; response: APIResponse }> =
      await Promise.all(
        Array.from(
          { length: BURST_SIZE },
          (_unused: unknown, index: number) => {
            const isReady: boolean = index % 2 === 0;
            const endpoint: string = isReady ? readyEndpoint : liveEndpoint;
            return page.request.get(endpoint).then((response: APIResponse) => {
              return { kind: isReady ? "ready" : "live", response } as {
                kind: "ready" | "live";
                response: APIResponse;
              };
            });
          },
        ),
      );

    for (const { response } of mixed) {
      expect(response.status()).toBeGreaterThanOrEqual(200);
      expect(response.status()).toBeLessThan(300);

      const body: unknown = await response.json();
      expect(body).toMatchObject({ status: "ok" });
    }
  });
});
