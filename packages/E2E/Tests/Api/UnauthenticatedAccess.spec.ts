import { BASE_URL } from "../../Config";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * Deployment contract for the API's authentication boundary.
 *
 * Permission unit tests already cover who may read what once a request is
 * authenticated. What they cannot cover is the assembled, deployed stack:
 * that nginx forwards these paths to the api service rather than answering
 * them itself, and that a request carrying no credentials is refused before
 * any row is read.
 *
 * That is worth an e2e because the failure mode is silent and total. Note
 * that UserMiddleware.getUserMiddleware does NOT refuse a credential-less
 * request — it marks it UserType.Public and calls next(). The refusal comes
 * from the read-permission layer further in, so "is this route closed?" is a
 * question only an assembled stack can answer, and a regression anywhere in
 * that chain would hand every project's rows to anyone who asks without a
 * single unit test going red.
 *
 * Every expectation below was taken from a running stack rather than assumed,
 * including the one route that deliberately answers 200.
 */

const endpointFor: (path: string) => string = (path: string): string => {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
};

const LIST_BODY: {
  query: Record<string, never>;
  select: Record<string, never>;
  skip: number;
  limit: number;
} = {
  query: {},
  select: {},
  skip: 0,
  limit: 10,
};

const JSON_HEADERS: { "content-type": string } = {
  "content-type": "application/json",
};

/*
 * NotAuthorizedException is 422 and the read-permission layer answers 401;
 * both are accepted so that hardening a denial into a different conventional
 * code is not read as a regression.
 */
const REFUSAL_STATUSES: Array<number> = [401, 403, 422];

/*
 * Tenant-scoped models whose rows belong to a project. A public caller has no
 * project, so reading any of them must be refused outright.
 */
const REFUSED_LIST_ROUTES: Array<string> = [
  "/api/monitor/get-list",
  "/api/incident/get-list",
  "/api/alert/get-list",
  "/api/status-page/get-list",
  "/api/team/get-list",
  "/api/api-key/get-list",
  "/api/user-notification-setting/get-list",
];

interface ListBody {
  data?: unknown;
  count?: unknown;
  error?: unknown;
}

async function readBody(response: APIResponse): Promise<ListBody> {
  return (await response.json().catch(() => {
    return {};
  })) as ListBody;
}

function expectNoRowsLeaked(body: ListBody): void {
  if (Array.isArray(body.data)) {
    expect(body.data).toHaveLength(0);
  }

  if (typeof body.count === "number") {
    expect(body.count).toBe(0);
  }
}

test.describe("API: the authentication boundary is closed", () => {
  for (const route of REFUSED_LIST_ROUTES) {
    test(`POST ${route} without credentials is refused`, async ({
      page,
    }: {
      page: Page;
    }): Promise<void> => {
      page.setDefaultNavigationTimeout(120000);

      const response: APIResponse = await page.request.post(
        endpointFor(route),
        { data: LIST_BODY, headers: JSON_HEADERS },
      );

      expect(response.status()).toBe(401);

      const body: ListBody = await readBody(response);
      expect(String(body.error || "")).toContain(
        "Authenticated user or a valid API key is needed",
      );
      expectNoRowsLeaked(body);
    });
  }

  /*
   * The GET form of get-list is mounted separately in BaseAPI with its own
   * middleware reference, so a route hardened only on POST would stay open to
   * a plain browser request. Covered explicitly for that reason.
   */
  test("GET /api/monitor/get-list without credentials is refused", async ({
    page,
  }: {
    page: Page;
  }): Promise<void> => {
    page.setDefaultNavigationTimeout(120000);

    const response: APIResponse = await page.request.get(
      endpointFor("/api/monitor/get-list"),
    );

    expect(response.status()).toBe(401);
    expectNoRowsLeaked(await readBody(response));
  });

  /*
   * `count` returns no rows, but it still answers questions about another
   * tenant's data ("how many incidents are open?"), so it sits behind the
   * same boundary as the list it counts.
   */
  test("POST /api/monitor/count without credentials is refused", async ({
    page,
  }: {
    page: Page;
  }): Promise<void> => {
    page.setDefaultNavigationTimeout(120000);

    const response: APIResponse = await page.request.post(
      endpointFor("/api/monitor/count"),
      { data: { query: {} }, headers: JSON_HEADERS },
    );

    expect(response.status()).toBe(401);
  });

  /*
   * Project is the deliberate exception: it is not tenant-scoped, it is
   * scoped to the caller, so a public caller is a caller with no projects
   * rather than a caller doing something forbidden. It answers 200 — and the
   * thing that matters is that the list is EMPTY. A regression that turned
   * this into "every project on the instance" would still be a 200, which is
   * exactly why the assertion is on the rows and not on the status.
   */
  test("POST /api/project/get-list never returns another caller's projects", async ({
    page,
  }: {
    page: Page;
  }): Promise<void> => {
    page.setDefaultNavigationTimeout(120000);

    const response: APIResponse = await page.request.post(
      endpointFor("/api/project/get-list"),
      { data: LIST_BODY, headers: JSON_HEADERS },
    );

    /*
     * Project is the one route here that is not tenant-scoped: it is scoped
     * to the CALLER, so a public caller is a caller with no projects rather
     * than one doing something forbidden, and a self-hosted stack answers 200
     * with an empty list rather than 401.
     *
     * The status is deliberately not pinned. Whether an instance refuses this
     * or answers an empty list is a configuration detail — it was observed as
     * 200 on a docker-compose stack, and asserting that everywhere would make
     * this test fail on a deployment that (reasonably) refuses instead, which
     * is not a regression. What is never acceptable, in either shape, is a row
     * coming back, because the failure worth catching here is "every project
     * on the instance" and that answer is also a 200.
     */
    if (response.status() === 200) {
      const body: ListBody = await readBody(response);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data).toHaveLength(0);
      expect(body.count).toBe(0);
    } else {
      expect(REFUSAL_STATUSES).toContain(response.status());
      expectNoRowsLeaked(await readBody(response));
    }
  });

  // Counting projects is refused even though listing them is not.
  test("POST /api/project/count without credentials is refused", async ({
    page,
  }: {
    page: Page;
  }): Promise<void> => {
    page.setDefaultNavigationTimeout(120000);

    const response: APIResponse = await page.request.post(
      endpointFor("/api/project/count"),
      { data: { query: {} }, headers: JSON_HEADERS },
    );

    expect(response.status()).toBe(401);
  });

  /*
   * A garbage bearer token must be rejected as a bad token — not mistaken for
   * a session, and not crashed on. A 5xx here would mean the token was acted
   * on before it was trusted.
   */
  test("a malformed bearer token is rejected as a bad token", async ({
    page,
  }: {
    page: Page;
  }): Promise<void> => {
    page.setDefaultNavigationTimeout(120000);

    const response: APIResponse = await page.request.post(
      endpointFor("/api/monitor/get-list"),
      {
        data: LIST_BODY,
        headers: {
          ...JSON_HEADERS,
          authorization: "Bearer not-a-real-token",
        },
      },
    );

    expect(response.status()).toBe(401);
    expect(response.status()).toBeLessThan(500);

    const body: { message?: unknown } = (await response.json().catch(() => {
      return {};
    })) as { message?: unknown };

    expect(String(body.message || "")).toContain("AccessToken is invalid");
  });

  /*
   * Control for the whole suite: it proves the api service is reachable at
   * this prefix, so the refusals above are refusals rather than nginx failing
   * to route the request anywhere at all.
   */
  test("the api service is reachable at the same prefix", async ({
    page,
  }: {
    page: Page;
  }): Promise<void> => {
    page.setDefaultNavigationTimeout(120000);

    const response: APIResponse = await page.request.get(
      endpointFor("/api/status"),
    );

    expect(response.status()).toBe(200);
  });
});
