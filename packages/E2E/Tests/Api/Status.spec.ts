import { BASE_URL } from "../../Config";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * Deployment contract for the API service's status surface (Common
 * StatusAPI, mounted by the api server at both `/api/...` and `/...`).
 *
 * Unit tests already exercise the handlers; this suite proves the routes are
 * actually mounted behind nginx and reachable at the `/api` prefix the rest of
 * the e2e suite already depends on for seeding. Kubernetes and load balancers
 * poll these exact paths, so a regression that unmounts them (or buries them
 * behind auth) breaks liveness/readiness in production — this catches that.
 *
 * These are dependency-light on purpose: `/api/status` is an unconditional
 * 200, and liveness/readiness must already be green for the stack to be
 * serving the rest of the suite at all, so the checks stay deterministic.
 */

const endpointFor: (path: string) => string = (path: string): string => {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
};

test.describe("API: status surface", () => {
  test("GET /api/status returns an ok status as JSON", async ({
    page,
  }: {
    page: Page;
  }): Promise<void> => {
    page.setDefaultNavigationTimeout(120000);

    const response: APIResponse = await page.request.get(
      endpointFor("/api/status"),
    );

    expect(response.status()).toBe(200);

    const headers: { [key: string]: string } = response.headers();
    expect(headers["content-type"] || "").toContain("application/json");

    const body: { status?: string } = (await response.json()) as {
      status?: string;
    };
    expect(body.status).toBe("ok");
  });

  test("GET /api/status/live reports the service is alive", async ({
    page,
  }: {
    page: Page;
  }): Promise<void> => {
    page.setDefaultNavigationTimeout(120000);

    const response: APIResponse = await page.request.get(
      endpointFor("/api/status/live"),
    );

    expect(response.status()).toBe(200);

    const body: { status?: string } = (await response.json()) as {
      status?: string;
    };
    expect(body.status).toBe("ok");
  });

  test("GET /api/status/ready reports the service is ready", async ({
    page,
  }: {
    page: Page;
  }): Promise<void> => {
    page.setDefaultNavigationTimeout(120000);

    /*
     * Readiness must be green for the rest of the suite to be served at all,
     * so this is a stable assertion rather than a race.
     */
    const response: APIResponse = await page.request.get(
      endpointFor("/api/status/ready"),
    );

    expect(response.status()).toBe(200);

    const body: { status?: string } = (await response.json()) as {
      status?: string;
    };
    expect(body.status).toBe("ok");
  });

  test("GET /api/app-name identifies the api service", async ({
    page,
  }: {
    page: Page;
  }): Promise<void> => {
    page.setDefaultNavigationTimeout(120000);

    const response: APIResponse = await page.request.get(
      endpointFor("/api/app-name"),
    );

    expect(response.status()).toBe(200);

    const body: { app?: string } = (await response.json()) as {
      app?: string;
    };
    // StartServer caches the appName ("api") that Common/Server/API mounts under.
    expect(body.app).toBe("api");
  });
});
