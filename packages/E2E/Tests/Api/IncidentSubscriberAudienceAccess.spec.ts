import { BASE_URL } from "../../Config";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * Deployment contract for POST /api/incident/subscriber-audience.
 *
 * The route answers who an incident's status page notifications would reach
 * before anything is sent: which of the project's status pages list its
 * monitors, and how many people subscribe to each. That is a map of the
 * project's status pages and their audience sizes, and unlike the CRUD routes
 * it is not a model read that the permission layer covers on its own - it is a
 * bespoke handler that assembles its answer from pages the caller may not be
 * able to read, holding back only their names.
 *
 * Unit tests cover the permission gate itself
 * (Common IncidentSubscriberAudienceCallerPermission), and they run against
 * the function. What they cannot say is whether the route as deployed is
 * behind authentication at all. The gate is the second of two checks - the
 * router puts UserMiddleware.requireUserAuthentication in front of it - so a
 * credential-less request must be refused before the handler is entered, and
 * before the tenant is even read off the request.
 *
 * Worth an e2e for the same reason as UnauthenticatedAccess.spec.ts: the
 * failure mode is silent. Nothing goes red if this route loses its middleware,
 * and the leak is not rows but the shape of a project's public presence.
 *
 * The expectations are the middleware's own, not guesses:
 * requireUserAuthentication answers NotAuthenticatedException, which is
 * ExceptionCode 401, with UserMiddleware.AUTHENTICATION_REQUIRED_MESSAGE.
 *
 * The refusal is read off `message`, not `error`, and which one carries it is
 * decided by HOW the request was refused rather than by the route:
 *
 *   - middleware that calls Response.sendErrorResponse itself -- which is what
 *     requireUserAuthentication does, and so what this route answers with --
 *     sends `{ message }`;
 *   - an exception thrown inside a handler reaches next(err) and the
 *     last-resort handler in StartServer, which sends `{ error }`.
 *
 * Hence UnauthenticatedAccess.spec.ts reading `error` for the CRUD routes,
 * whose refusal is thrown by the read-permission layer deep inside the handler,
 * and `message` for the invalid-access-token case, which is middleware again.
 * Same 401, different envelope. Asserting the wrong one still sees a 401 and
 * an empty string, so it fails as a missing message rather than as a route
 * that is open.
 */

const ROUTE: string = "/api/incident/subscriber-audience";

const endpointFor: (path: string) => string = (path: string): string => {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
};

const JSON_HEADERS: { "content-type": string } = {
  "content-type": "application/json",
};

interface AudienceBody {
  message?: unknown;
  statusPages?: unknown;
  excludedStatusPages?: unknown;
  counts?: unknown;
  subscriberCount?: unknown;
}

async function readBody(response: APIResponse): Promise<AudienceBody> {
  return (await response.json().catch(() => {
    return {};
  })) as AudienceBody;
}

/*
 * A refusal must carry none of the answer. Checked field by field rather than
 * by comparing the whole body, so a future addition to the response shape does
 * not quietly stop being checked.
 */
function expectNoAudienceLeaked(body: AudienceBody): void {
  expect(body.statusPages).toBeUndefined();
  expect(body.excludedStatusPages).toBeUndefined();
  expect(body.counts).toBeUndefined();
  expect(body.subscriberCount).toBeUndefined();
}

function expectAuthenticationRefusal(response: APIResponse): void {
  expect(response.status()).toBe(401);
}

test.describe("API: the incident subscriber audience is behind authentication", () => {
  /*
   * The two request shapes the route accepts: an incident that exists, and one
   * being declared. Both are refused on the same middleware, but they take
   * different paths through parseSubscriberAudienceRequest once past it, so a
   * route left open on one shape only would not show up in the other.
   */
  const BODIES: Array<{ label: string; body: Record<string, unknown> }> = [
    {
      label: "an existing incident",
      body: { incidentId: "00000000-0000-4000-8000-000000000001" },
    },
    {
      label: "an incident being declared",
      body: { monitorIds: [], statusPageIds: [] },
    },
    {
      label: "a retry of the created notification",
      body: {
        incidentId: "00000000-0000-4000-8000-000000000001",
        excludeStatusPagesNotifiedOnCreation: true,
      },
    },
    { label: "an empty body", body: {} },
  ];

  for (const shape of BODIES) {
    test(`POST ${ROUTE} for ${shape.label} without credentials is refused`, async ({
      page,
    }: {
      page: Page;
    }): Promise<void> => {
      page.setDefaultNavigationTimeout(120000);

      const response: APIResponse = await page.request.post(
        endpointFor(ROUTE),
        { data: shape.body, headers: JSON_HEADERS },
      );

      expectAuthenticationRefusal(response);

      const body: AudienceBody = await readBody(response);
      expect(String(body.message || "")).toContain("Authentication required");
      expectNoAudienceLeaked(body);
    });
  }

  /*
   * A malformed body must not be read before the caller is: parsing first would
   * answer BadDataException, telling an anonymous caller what the route expects
   * and confirming it is there.
   */
  test("a malformed body is still refused for the credentials, not the body", async ({
    page,
  }: {
    page: Page;
  }): Promise<void> => {
    page.setDefaultNavigationTimeout(120000);

    const response: APIResponse = await page.request.post(endpointFor(ROUTE), {
      // Both shapes at once, which parseSubscriberAudienceRequest rejects.
      data: {
        incidentId: "00000000-0000-4000-8000-000000000001",
        monitorIds: [],
        statusPageIds: [],
      },
      headers: JSON_HEADERS,
    });

    expectAuthenticationRefusal(response);
    expectNoAudienceLeaked(await readBody(response));
  });

  /*
   * A made-up bearer token is not a way in either, though it is refused a step
   * earlier and for a different reason: getUserMiddleware reads the token from
   * the Authorization header as well as the cookie, and one it cannot decode is
   * answered on the spot ("AccessToken is invalid or expired") rather than
   * being carried through as anonymous. Both refusals are 401, so the status is
   * asserted for both and the wording is allowed to be either - what matters
   * here is that neither reaches the handler.
   */
  test("a made-up bearer token does not get past the middleware", async ({
    page,
  }: {
    page: Page;
  }): Promise<void> => {
    page.setDefaultNavigationTimeout(120000);

    const response: APIResponse = await page.request.post(endpointFor(ROUTE), {
      data: { monitorIds: [], statusPageIds: [] },
      headers: { ...JSON_HEADERS, authorization: "Bearer not-a-real-token" },
    });

    expectAuthenticationRefusal(response);

    const body: AudienceBody = await readBody(response);
    expect(String(body.message || "")).toMatch(
      /Authentication required|AccessToken is invalid or expired/,
    );
    expectNoAudienceLeaked(body);
  });

  /*
   * The route is registered for POST alone. A GET reaching the handler would
   * mean it was mounted for every method, which would also put the request
   * shape in a URL and therefore in access logs. 404 and 405 are both accepted:
   * which one an unmatched method gets is Express's business, and neither is
   * the handler answering.
   */
  test("the route is not reachable by GET", async ({
    page,
  }: {
    page: Page;
  }): Promise<void> => {
    page.setDefaultNavigationTimeout(120000);

    const response: APIResponse = await page.request.get(endpointFor(ROUTE));

    expect([404, 405]).toContain(response.status());
    expectNoAudienceLeaked(await readBody(response));
  });
});
