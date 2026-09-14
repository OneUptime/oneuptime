import { BASE_URL } from "../../Config";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * The front door on the generic CRUD API, checked in a real deployment.
 *
 * Every tenant-scoped model is served by BaseAPI on the same generated routes
 * - get-list, count, get-item, create, update, delete - and each is registered
 * behind UserMiddleware.getUserMiddleware. With no credentials the caller
 * holds Permission.Public alone, carries no tenant, and the permission layer
 * refuses before a row is touched.
 *
 * That chain is covered thoroughly by unit tests, all of which run with the
 * middleware and the permission layer constructed by hand. What none of them
 * can show is that the chain is actually MOUNTED in a deployed stack: a router
 * registered without the middleware, an nginx location reaching the App
 * service by a path the router does not guard, or a model whose read
 * permissions were widened to Public by accident would leave every unit test
 * green while the deployment answers a stranger's list request with rows.
 *
 * The suite is deliberately a sweep rather than one endpoint. These routes are
 * generated from the model, so the interesting failure is never "monitor
 * broke" - it is a change to BaseAPI, to the middleware, or to the ingress
 * that unlatches a whole class of resources at once, and a single-endpoint
 * test would catch that only by luck.
 *
 * Each case pins the SPECIFIC refusal rather than merely a 4xx. A 404 and a
 * 401 are both client errors and only one of them means "the guard ran": a
 * route that disappeared entirely would satisfy a status-range assertion
 * while proving nothing at all about authentication.
 *
 * Everything here is deterministic and needs no seeded data: these routes are
 * mounted unconditionally by the api feature set, and refusing an anonymous
 * caller depends on nothing in the database.
 */

/*
 * Tenant-scoped resources whose read permissions name project roles only -
 * none of them lists Permission.Public - spanning the kinds of data an
 * anonymous read would be worst for: the estate itself (monitor), the
 * operational record (incident, alert), the people (team, user), the
 * credentials (api-key), and the automation that can act on all of it
 * (workflow, on-call-duty-policy).
 */
const PROTECTED_RESOURCES: Array<string> = [
  "monitor",
  "incident",
  "alert",
  "team",
  "user",
  "api-key",
  "on-call-duty-policy",
  "workflow",
  "dashboard",
  "label",
];

// Well-formed and belonging to nothing, so the refusal cannot be a lookup miss.
const WELL_FORMED_ID: string = "00000000-0000-4000-8000-000000000000";

type BuildEndpointFunction = (route: string) => string;

const buildEndpoint: BuildEndpointFunction = (route: string): string => {
  return URL.fromString(BASE_URL.toString()).addRoute(route).toString();
};

/*
 * Asserted on the raw body as well as the status, because the shape of a
 * refusal is the handler's business and the shape of a leak is not. A list
 * response always carries `data` alongside its paging fields; a refusal
 * carries none of them. Checking the text means a 401 that somehow still
 * attached an envelope - a disclosure that the resource exists, and one
 * refactor away from a disclosure of its rows - cannot pass.
 */
type ExpectNoRowsFunction = (body: string) => void;

const expectNoRows: ExpectNoRowsFunction = (body: string): void => {
  expect(body).not.toContain('"data"');
  expect(body).not.toContain('"skip"');
  expect(body).not.toContain('"limit"');
  expect(body).not.toContain('"count"');
};

/*
 * The permission layer's own refusal, verbatim from
 * BasePermission.checkIfUserIsLoggedIn: "Authenticated user or a valid API key
 * is needed to <verb> record of <Model>." Matching the sentence is what
 * distinguishes "the guard ran and said no" from any other 401 the stack could
 * produce - an expired session, a missing route, a proxy in front of it.
 */
type ExpectPermissionRefusalFunction = (data: {
  response: APIResponse;
  body: string;
  verb: string;
}) => void;

const expectPermissionRefusal: ExpectPermissionRefusalFunction = (data: {
  response: APIResponse;
  body: string;
  verb: string;
}): void => {
  expect(data.response.status()).toBe(401);
  expect(data.body).toContain(
    `Authenticated user or a valid API key is needed to ${data.verb} record of`,
  );
};

test.describe("the CRUD API refuses anonymous callers in a deployed stack", () => {
  for (const resource of PROTECTED_RESOURCES) {
    test(`POST /api/${resource}/get-list returns no rows to a caller with no credentials`, async ({
      page,
    }: {
      page: Page;
    }): Promise<void> => {
      page.setDefaultNavigationTimeout(120000); // 2 minutes

      const response: APIResponse = await page.request.post(
        buildEndpoint(`/api/${resource}/get-list`),
        {
          data: { query: {}, select: {}, skip: 0, limit: 10 },
        },
      );

      const body: string = await response.text();

      expectPermissionRefusal({
        response: response,
        body: body,
        verb: "read",
      });
      expectNoRows(body);
    });

    test(`POST /api/${resource}/count returns no count to a caller with no credentials`, async ({
      page,
    }: {
      page: Page;
    }): Promise<void> => {
      page.setDefaultNavigationTimeout(120000); // 2 minutes

      const response: APIResponse = await page.request.post(
        buildEndpoint(`/api/${resource}/count`),
        {
          data: { query: {} },
        },
      );

      const body: string = await response.text();

      /*
       * A count is a disclosure on its own - "this project has 14 api keys" is
       * something a stranger should not be able to obtain - and it is the
       * cheapest thing to leak by accident, because the body looks harmless.
       */
      expectPermissionRefusal({
        response: response,
        body: body,
        verb: "read",
      });
      expectNoRows(body);
    });
  }

  /*
   * The GET spelling of get-list is registered separately from the POST one,
   * with its own middleware argument. A change that guards one and not the
   * other is exactly what a sweep over POST alone would miss.
   */
  test("the GET spelling of get-list is guarded too", async ({
    page,
  }: {
    page: Page;
  }): Promise<void> => {
    page.setDefaultNavigationTimeout(120000); // 2 minutes

    for (const resource of PROTECTED_RESOURCES) {
      const response: APIResponse = await page.request.get(
        buildEndpoint(`/api/${resource}/get-list`),
      );

      const body: string = await response.text();

      expectPermissionRefusal({
        response: response,
        body: body,
        verb: "read",
      });
      expectNoRows(body);
    }
  });

  /*
   * Reading one row by id is a separate route from listing, and it is the one
   * an attacker uses once an id has leaked somewhere else - a status page, a
   * webhook payload, a shared URL.
   */
  test("fetching a single item by id is guarded too", async ({
    page,
  }: {
    page: Page;
  }): Promise<void> => {
    page.setDefaultNavigationTimeout(120000); // 2 minutes

    for (const resource of PROTECTED_RESOURCES) {
      const response: APIResponse = await page.request.post(
        buildEndpoint(`/api/${resource}/${WELL_FORMED_ID}/get-item`),
        {
          data: { select: {} },
        },
      );

      const body: string = await response.text();

      expectPermissionRefusal({
        response: response,
        body: body,
        verb: "read",
      });
      expectNoRows(body);
    }
  });

  /*
   * Writes matter more than reads, and they run on the same router behind the
   * same middleware. A delete that fell through would not merely disclose the
   * project - it would let a stranger take rows out of it.
   */
  test("deleting is guarded, in both of its spellings", async ({
    page,
  }: {
    page: Page;
  }): Promise<void> => {
    page.setDefaultNavigationTimeout(120000); // 2 minutes

    for (const resource of PROTECTED_RESOURCES) {
      const deleted: APIResponse = await page.request.delete(
        buildEndpoint(`/api/${resource}/${WELL_FORMED_ID}`),
      );

      expectPermissionRefusal({
        response: deleted,
        body: await deleted.text(),
        verb: "delete",
      });

      const deletedByPost: APIResponse = await page.request.post(
        buildEndpoint(`/api/${resource}/${WELL_FORMED_ID}/delete-item`),
        { data: {} },
      );

      expectPermissionRefusal({
        response: deletedByPost,
        body: await deletedByPost.text(),
        verb: "delete",
      });
    }
  });

  test("updating is guarded, in both of its spellings", async ({
    page,
  }: {
    page: Page;
  }): Promise<void> => {
    page.setDefaultNavigationTimeout(120000); // 2 minutes

    for (const resource of PROTECTED_RESOURCES) {
      const updated: APIResponse = await page.request.put(
        buildEndpoint(`/api/${resource}/${WELL_FORMED_ID}`),
        { data: { data: { name: "e2e-unauthenticated-probe" } } },
      );

      expectPermissionRefusal({
        response: updated,
        body: await updated.text(),
        verb: "update",
      });

      const updatedByPost: APIResponse = await page.request.post(
        buildEndpoint(`/api/${resource}/${WELL_FORMED_ID}/update-item`),
        { data: { data: { name: "e2e-unauthenticated-probe" } } },
      );

      expectPermissionRefusal({
        response: updatedByPost,
        body: await updatedByPost.text(),
        verb: "update",
      });
    }
  });

  /*
   * Creating an API key is the single worst thing on this list to leave open -
   * it would mint the credential every other refusal here is protecting - and
   * it is also the clean case to assert precisely: its service validates
   * nothing ahead of the permission check, so the 401 below is unambiguously
   * the guard and not a missing field.
   */
  test("creating an API key without credentials is refused by the permission layer", async ({
    page,
  }: {
    page: Page;
  }): Promise<void> => {
    page.setDefaultNavigationTimeout(120000); // 2 minutes

    const response: APIResponse = await page.request.post(
      buildEndpoint("/api/api-key"),
      {
        data: {
          data: {
            name: "e2e-unauthenticated-probe",
            projectId: WELL_FORMED_ID,
            expiresAt: "2030-01-01T00:00:00.000Z",
          },
        },
      },
    );

    expectPermissionRefusal({
      response: response,
      body: await response.text(),
      verb: "create",
    });
  });

  /*
   * The rest of the create routes are held to a weaker but still meaningful
   * bar: several services validate the payload before the permission check
   * runs, so the refusal is theirs rather than the guard's. What must never
   * happen on any of them is a 2xx - that would mean a stranger wrote a row.
   */
  test("no create route accepts an anonymous write", async ({
    page,
  }: {
    page: Page;
  }): Promise<void> => {
    page.setDefaultNavigationTimeout(120000); // 2 minutes

    for (const resource of PROTECTED_RESOURCES) {
      const response: APIResponse = await page.request.post(
        buildEndpoint(`/api/${resource}`),
        {
          data: {
            data: {
              name: "e2e-unauthenticated-probe",
              projectId: WELL_FORMED_ID,
            },
          },
        },
      );

      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect(response.status()).toBeLessThan(500);
      expect(await response.text()).not.toContain('"_id"');
    }
  });

  /*
   * A token that does not decode is a different path through the middleware
   * from no token at all - it is answered before the handler is reached, so a
   * client knows to refresh rather than to sign in again - and it must not be
   * a way around the guard.
   */
  test("a malformed bearer token is refused before the handler is reached", async ({
    page,
  }: {
    page: Page;
  }): Promise<void> => {
    page.setDefaultNavigationTimeout(120000); // 2 minutes

    for (const resource of PROTECTED_RESOURCES) {
      const response: APIResponse = await page.request.post(
        buildEndpoint(`/api/${resource}/get-list`),
        {
          data: { query: {}, select: {}, skip: 0, limit: 10 },
          headers: {
            /*
             * The middleware only reads an Authorization header as a token in
             * the "Bearer <token>" form the mobile app sends; anything else is
             * ignored and falls through to the anonymous path above. The
             * scheme is spelled out on purpose - without it this would
             * silently be a second copy of the no-credentials case.
             */
            authorization: "Bearer not-a-real-token",
          },
        },
      );

      const body: string = await response.text();

      expect(response.status()).toBe(401);
      expect(body).toContain("AccessToken is invalid or expired");
      expectNoRows(body);
    }
  });

  /*
   * An API key is the other credential these routes accept. A garbage one must
   * be rejected outright rather than ignored - falling through to the
   * anonymous path would be a quieter failure, and a key that is merely
   * ignored is a key nobody notices has stopped working.
   */
  test("a garbage API key is rejected rather than ignored", async ({
    page,
  }: {
    page: Page;
  }): Promise<void> => {
    page.setDefaultNavigationTimeout(120000); // 2 minutes

    for (const resource of PROTECTED_RESOURCES) {
      const response: APIResponse = await page.request.post(
        buildEndpoint(`/api/${resource}/get-list`),
        {
          data: { query: {}, select: {}, skip: 0, limit: 10 },
          headers: {
            apikey: WELL_FORMED_ID,
            projectid: WELL_FORMED_ID,
          },
        },
      );

      const body: string = await response.text();

      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect(response.status()).toBeLessThan(500);
      expect(body).toContain("Invalid API Key");
      expectNoRows(body);
    }
  });
});
