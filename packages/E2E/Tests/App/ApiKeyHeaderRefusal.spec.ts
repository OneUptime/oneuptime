import { BASE_URL } from "../../Config";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * A caller that sends an `apikey` header and gets it wrong, checked against a
 * real deployment.
 *
 * ProjectMiddleware deliberately claims such a request rather than letting it
 * fall through to the anonymous path: a non-UUID string, or duplicate headers
 * Node joined with a comma, are somebody trying to authenticate by key.
 * Routed down the anonymous path they failed much later with "A user should be
 * logged in to ... record of <Model>" -- an error about session auth, naming a
 * model, raised against a caller who never attempted session auth. It reads as
 * an RBAC bug in whatever resource was asked for, and was reported as one
 * twice (#1754, #3004).
 *
 * The middleware's own unit tests cover hasApiKey and getApiKey exhaustively,
 * with the request built by hand. What they cannot show is what a deployed
 * stack answers, and one thing only appears here: `apiKey.apiKey` is a
 * Postgres `uuid` column, so a non-UUID value that reaches the query layer
 * raises "invalid input syntax for type uuid". That is a raw QueryFailedError,
 * not a OneUptime Exception, so it slips past the error translator and answers
 * 500 -- a malformed request served as a server fault. Only a call through the
 * real database can show the shape check still stops it, which is why every
 * case below asserts the status is under 500 and not merely an error.
 *
 * Every value here is non-empty on the wire, so nothing depends on how the
 * proxy in front of the App treats an empty header field; the empty and
 * whitespace-only cases are the unit tests' to own.
 *
 * Everything is deterministic and needs no seeded data: the refusal depends on
 * the header alone, and none of these values can match a row.
 */

// Well-formed and belonging to nothing, so a refusal is never a lookup miss.
const WELL_FORMED_ID: string = "00000000-0000-4000-8000-000000000000";

/*
 * One resource is enough: the middleware runs before the route's own handler
 * and never looks at which model was asked for. The anonymous sweep in
 * UnauthenticatedCrudApiAccess.spec.ts is the one that needs breadth.
 */
const LIST_ROUTE: string = "/api/monitor/get-list";
const CREATE_ROUTE: string = "/api/monitor";

const LIST_REQUEST: Record<string, unknown> = {
  query: {},
  select: {},
  skip: 0,
  limit: 10,
};

type BuildEndpointFunction = (route: string) => string;

const buildEndpoint: BuildEndpointFunction = (route: string): string => {
  return URL.fromString(BASE_URL.toString()).addRoute(route).toString();
};

/*
 * The refusal must carry nothing that looks like a list response. A body with
 * an envelope would mean the guard let the request reach the handler.
 */
type ExpectNoRowsFunction = (body: string) => void;

const expectNoRows: ExpectNoRowsFunction = (body: string): void => {
  expect(body).not.toContain('"data"');
  expect(body).not.toContain('"skip"');
  expect(body).not.toContain('"limit"');
  expect(body).not.toContain('"count"');
};

/*
 * "Invalid API Key" is ProjectMiddleware's own sentence for a caller who sent
 * a key and got it wrong. Matching it, rather than a status range, is what
 * separates this from every other 4xx the stack can produce.
 */
type ExpectInvalidKeyFunction = (data: {
  response: APIResponse;
  body: string;
}) => void;

const expectInvalidKey: ExpectInvalidKeyFunction = (data: {
  response: APIResponse;
  body: string;
}): void => {
  expect(data.response.status()).toBeGreaterThanOrEqual(400);
  // A 500 here is the "invalid input syntax for type uuid" regression.
  expect(data.response.status()).toBeLessThan(500);
  expect(data.body).toContain("Invalid API Key");
  /*
   * And specifically NOT the anonymous path's error, which is the wrong
   * answer this whole branch exists to stop.
   */
  expect(data.body).not.toContain("should be logged in");
  expect(data.body).not.toContain("Authenticated user or a valid API key");
  expectNoRows(data.body);
};

/*
 * Header values a real caller arrives with. Each is a key that was sent and
 * cannot be resolved -- either because it is not uuid-shaped, so the lookup
 * must never run, or because it is well-formed and matches nothing.
 */
const UNUSABLE_KEYS: Array<{ label: string; value: string }> = [
  { label: "a non-UUID word", value: "not-a-uuid" },
  { label: "a truncated UUID", value: "00000000-0000-4000-8000" },
  { label: "a UUID with a trailing character", value: `${WELL_FORMED_ID}x` },
  {
    label: "a UUID with its dashes removed",
    value: WELL_FORMED_ID.replace(/-/g, ""),
  },
  // What Node hands the app when the header arrives twice.
  {
    label: "two UUIDs comma-joined, as duplicate headers arrive",
    value: `${WELL_FORMED_ID},${WELL_FORMED_ID}`,
  },
  // Well-formed, so the lookup does run; it just finds nothing.
  {
    label: "a well-formed UUID that belongs to nothing",
    value: WELL_FORMED_ID,
  },
];

test.describe("an unusable API key header is refused, not ignored", () => {
  for (const unusableKey of UNUSABLE_KEYS) {
    test(`an apikey header that is ${unusableKey.label} is refused as an invalid key`, async ({
      page,
    }: {
      page: Page;
    }): Promise<void> => {
      page.setDefaultNavigationTimeout(120000); // 2 minutes

      const response: APIResponse = await page.request.post(
        buildEndpoint(LIST_ROUTE),
        {
          data: LIST_REQUEST,
          headers: { apikey: unusableKey.value },
        },
      );

      expectInvalidKey({
        response: response,
        body: await response.text(),
      });
    });
  }

  /*
   * A projectid alongside the bad key must not rescue it. The tenant header is
   * caller-supplied and proves nothing; taking it as authority would let
   * anyone name a project and be believed.
   */
  test("a projectid header does not rescue an unusable key", async ({
    page,
  }: {
    page: Page;
  }): Promise<void> => {
    page.setDefaultNavigationTimeout(120000); // 2 minutes

    for (const unusableKey of UNUSABLE_KEYS) {
      const response: APIResponse = await page.request.post(
        buildEndpoint(LIST_ROUTE),
        {
          data: LIST_REQUEST,
          headers: {
            apikey: unusableKey.value,
            projectid: WELL_FORMED_ID,
          },
        },
      );

      expectInvalidKey({
        response: response,
        body: await response.text(),
      });
    }
  });

  /*
   * The other half of the distinction: with no apikey header at all the
   * request is anonymous, and gets the permission layer's own sentence
   * instead. If this ever started saying "Invalid API Key" the branch would
   * have swallowed the anonymous path rather than sitting beside it.
   */
  test("no apikey header at all still takes the anonymous path", async ({
    page,
  }: {
    page: Page;
  }): Promise<void> => {
    page.setDefaultNavigationTimeout(120000); // 2 minutes

    const response: APIResponse = await page.request.post(
      buildEndpoint(LIST_ROUTE),
      {
        data: LIST_REQUEST,
      },
    );

    const body: string = await response.text();

    expect(response.status()).toBe(401);
    expect(body).toContain(
      "Authenticated user or a valid API key is needed to read record of",
    );
    expect(body).not.toContain("Invalid API Key");
    expectNoRows(body);
  });

  /*
   * The GET spelling of get-list is registered separately, with its own
   * middleware argument, so it is guarded separately too.
   */
  test("the GET spelling of get-list refuses an unusable key too", async ({
    page,
  }: {
    page: Page;
  }): Promise<void> => {
    page.setDefaultNavigationTimeout(120000); // 2 minutes

    for (const unusableKey of UNUSABLE_KEYS) {
      const response: APIResponse = await page.request.get(
        buildEndpoint(LIST_ROUTE),
        {
          headers: { apikey: unusableKey.value },
        },
      );

      expectInvalidKey({
        response: response,
        body: await response.text(),
      });
    }
  });

  /*
   * A write is the request that matters most, and create is a different route
   * with its own middleware argument. A guard that ran on reads alone would be
   * worse than none.
   */
  test("a create request with an unusable key is refused before anything is written", async ({
    page,
  }: {
    page: Page;
  }): Promise<void> => {
    page.setDefaultNavigationTimeout(120000); // 2 minutes

    for (const unusableKey of UNUSABLE_KEYS) {
      const response: APIResponse = await page.request.post(
        buildEndpoint(CREATE_ROUTE),
        {
          data: { data: { name: "e2e-should-never-exist" } },
          headers: { apikey: unusableKey.value },
        },
      );

      expectInvalidKey({
        response: response,
        body: await response.text(),
      });
    }
  });

  /*
   * Update and delete take the remaining two verbs, each registered on its own
   * route. The id is well-formed and belongs to nothing, so a refusal here can
   * only be the credential -- never a lookup miss.
   */
  test("update and delete with an unusable key are refused on their own routes", async ({
    page,
  }: {
    page: Page;
  }): Promise<void> => {
    page.setDefaultNavigationTimeout(120000); // 2 minutes

    const itemRoute: string = `${CREATE_ROUTE}/${WELL_FORMED_ID}`;

    for (const unusableKey of UNUSABLE_KEYS) {
      const updateResponse: APIResponse = await page.request.put(
        buildEndpoint(itemRoute),
        {
          data: { data: { name: "e2e-should-never-exist" } },
          headers: { apikey: unusableKey.value },
        },
      );

      expectInvalidKey({
        response: updateResponse,
        body: await updateResponse.text(),
      });

      const deleteResponse: APIResponse = await page.request.delete(
        buildEndpoint(itemRoute),
        {
          headers: { apikey: unusableKey.value },
        },
      );

      expectInvalidKey({
        response: deleteResponse,
        body: await deleteResponse.text(),
      });
    }
  });
});
