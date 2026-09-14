import { BASE_URL } from "../../Config";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * The session replay ingest surface, seen by a caller with no credentials.
 *
 * These routes are the one part of session replay that is reachable from any
 * browser on the internet: the snippet a customer pastes into their site
 * posts recorded frames to /session-replay/v1/chunk and reads its policy from
 * /session-replay/v1/config. Everything else in the feature sits behind a
 * dashboard login.
 *
 * Nothing here needs a project, a probe or a recording, so it is fast and
 * deterministic - which is the point. The properties it pins are the ones an
 * unauthenticated caller could otherwise discover the hard way:
 *
 *   - every ingest route answers 401, never 200 and never 5xx;
 *   - the refusal is JSON, so a recorder can read it rather than parsing an
 *     HTML error page;
 *   - both mount prefixes behave identically (the router is mounted under
 *     TELEMETRY_PREFIXES, and a prefix that skipped the guard would be a
 *     wide-open ingest endpoint);
 *   - the 401 arrives WITHOUT the server buffering the body, which is why
 *     the ingestion-key middleware runs before the body reader;
 *   - the pinned recorder artifact is served only for a well-formed version,
 *     so the version segment cannot be steered anywhere.
 */

const INGEST_PREFIXES: Array<string> = ["", "/telemetry"];

function endpoint(path: string): string {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
}

test.describe("Session replay ingest refuses an unauthenticated caller", () => {
  for (const prefix of INGEST_PREFIXES) {
    const label: string = prefix || "(unprefixed)";

    test(`${label} /session-replay/v1/chunk answers 401 JSON`, async ({
      page,
    }: {
      page: Page;
    }) => {
      page.setDefaultNavigationTimeout(120000);

      const response: APIResponse = await page.request.post(
        endpoint(`${prefix}/session-replay/v1/chunk`),
        {
          headers: { "content-type": "application/octet-stream" },
          data: Buffer.from([0, 0, 0, 0]),
        },
      );

      expect(response.status()).toBe(401);
      expect(response.headers()["content-type"]).toContain("application/json");
    });

    test(`${label} /session-replay/v1/config answers 401 JSON`, async ({
      page,
    }: {
      page: Page;
    }) => {
      page.setDefaultNavigationTimeout(120000);

      const response: APIResponse = await page.request.get(
        endpoint(`${prefix}/session-replay/v1/config`),
      );

      expect(response.status()).toBe(401);
      expect(response.headers()["content-type"]).toContain("application/json");
    });

    test(`${label} /session-replay/v1/validate names the missing token`, async ({
      page,
    }: {
      page: Page;
    }) => {
      page.setDefaultNavigationTimeout(120000);

      const response: APIResponse = await page.request.get(
        endpoint(`${prefix}/session-replay/v1/validate`),
      );

      expect(response.status()).toBe(401);

      const body: Record<string, unknown> = (await response.json()) as Record<
        string,
        unknown
      >;

      /*
       * The probe endpoint exists so a customer can tell "no key" from "bad
       * key" without reading server logs, so it says which it was.
       */
      expect(body["tokenProvided"]).toBe(false);
      expect(body["valid"]).toBe(false);
      expect(String(body["message"])).toContain("x-oneuptime-token");
    });
  }

  test("an unknown ingestion key is refused as unknown, not accepted", async ({
    page,
  }: {
    page: Page;
  }) => {
    page.setDefaultNavigationTimeout(120000);

    const response: APIResponse = await page.request.get(
      endpoint("/session-replay/v1/validate"),
      {
        headers: {
          "x-oneuptime-token": "0193c0de-dead-4bee-8fff-000000000000",
        },
      },
    );

    expect(response.status()).toBe(401);

    const body: Record<string, unknown> = (await response.json()) as Record<
      string,
      unknown
    >;

    expect(body["tokenProvided"]).toBe(true);
    expect(body["valid"]).toBe(false);
  });

  test("a large unauthenticated chunk is refused without being buffered", async ({
    page,
  }: {
    page: Page;
  }) => {
    page.setDefaultNavigationTimeout(120000);

    /*
     * The ingestion-key check reads headers only and runs BEFORE the body
     * reader, so a body past the 2 MiB per-request cap is still answered 401
     * rather than 413 - the server never read it. A 413 here would mean the
     * order had been swapped back and an anonymous caller could make this
     * process buffer megabytes per request.
     */
    const response: APIResponse = await page.request.post(
      endpoint("/session-replay/v1/chunk"),
      {
        headers: { "content-type": "application/octet-stream" },
        data: Buffer.alloc(3 * 1024 * 1024, 0),
      },
    );

    expect(response.status()).toBe(401);
  });
});

test.describe("Session replay recorder artifact", () => {
  test("a malformed version is 404, never a served file", async ({
    page,
  }: {
    page: Page;
  }) => {
    page.setDefaultNavigationTimeout(120000);

    /*
     * Rejected by RECORDER_VERSION_PATTERN before the manifest is consulted,
     * plus one well-formed version that was never published - which the
     * manifest itself must refuse rather than serving today's bytes under it.
     */
    for (const version of ["not-a-version", "1.2.3.4.5", "0.0.0"]) {
      const response: APIResponse = await page.request.get(
        endpoint(`/session-replay/v${version}/recorder.js`),
      );

      expect(
        response.status(),
        `version "${version}" must not resolve to an artifact`,
      ).toBe(404);
    }
  });

  test("the fixed loader path answers without a credential, and never 5xx", async ({
    page,
  }: {
    page: Page;
  }) => {
    page.setDefaultNavigationTimeout(120000);

    const response: APIResponse = await page.request.get(
      endpoint("/session-replay/v1/recorder.js"),
    );

    /*
     * 200 where the recorder bundle was built, 404 on a deployment where it
     * was not. Both are answers the customer's console can act on; a 5xx is
     * not, and neither is a credential prompt for a file every visitor's
     * browser has to fetch.
     */
    expect([200, 404]).toContain(response.status());

    if (response.status() === 200) {
      expect(response.headers()["content-type"]).toContain("javascript");
    }
  });
});
