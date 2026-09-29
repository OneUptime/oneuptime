import { BASE_URL } from "../../Config";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * Contract check for the App service's /app-name endpoint.
 *
 * StatusAPI (Common/Server/API/StatusAPI.ts) mounts GET /app-name on the same
 * router as /status, /status/ready and /status/live. Unlike the health probes,
 * /app-name is not exercised by any other E2E suite even though it is always
 * mounted and is used by the frontend/tooling to discover which service is
 * answering. Its contract is:
 *
 *   - responds with a 2xx status code,
 *   - is served as JSON (not an HTML error page), and
 *   - returns a body of the shape { app: <string> }.
 *
 * A regression that stopped registering this route (404/HTML) or changed the
 * body shape would slip past every /status-focused suite; this guards it.
 */

test.describe("App service /app-name endpoint", () => {
  test("responds 200 with a JSON { app: string } body", async ({
    page,
  }: {
    page: Page;
  }) => {
    page.setDefaultNavigationTimeout(120000); // 2 minutes

    const endpoint: string = URL.fromString(BASE_URL.toString())
      .addRoute("/app-name")
      .toString();

    const response: APIResponse = await page.request.get(endpoint);

    // Status code should be a success code.
    expect(response.status()).toBeGreaterThanOrEqual(200);
    expect(response.status()).toBeLessThan(300);

    // Body should parse as JSON and expose an `app` field that is a string.
    const body: unknown = await response.json();

    expect(typeof body).toBe("object");
    expect(body).not.toBeNull();

    const appField: unknown = (body as { app?: unknown }).app;
    expect(typeof appField).toBe("string");
  });

  test("is idempotent across repeated calls", async ({
    page,
  }: {
    page: Page;
  }) => {
    page.setDefaultNavigationTimeout(120000); // 2 minutes

    const endpoint: string = URL.fromString(BASE_URL.toString())
      .addRoute("/app-name")
      .toString();

    const firstResponse: APIResponse = await page.request.get(endpoint);
    const secondResponse: APIResponse = await page.request.get(endpoint);

    expect(firstResponse.status()).toBe(secondResponse.status());

    const firstBody: { app?: unknown } = (await firstResponse.json()) as {
      app?: unknown;
    };
    const secondBody: { app?: unknown } = (await secondResponse.json()) as {
      app?: unknown;
    };

    // The identity of the answering service must not drift between calls.
    expect(firstBody.app).toEqual(secondBody.app);
  });
});
