import {
  IDENTITY_PREFIXES,
  IDENTITY_PROBES,
  PAGE_NOT_FOUND_MESSAGE_FRAGMENT,
  SCIM_ERROR_SCHEMA_URN,
  SSO_LOGIN_PAGE_PATH,
  SSO_UNAVAILABLE_PAGE_ADVICE_FRAGMENT,
  SSO_UNAVAILABLE_TITLE,
  identityProbeUrl,
} from "../Helpers/IdentityRoutes";
import { assertLapsedEnterpriseStack } from "../Helpers/StackGuard";
import { APIRequestContext, APIResponse, expect, test } from "@playwright/test";

/*
 * What a lapsed licence does to the enterprise identity surface on a real
 * stack: every route still EXISTS and every route REFUSES.
 *
 * What this proves that the jest suites cannot: ee/Tests/Server/Identity/
 * IdentityRoutesLicenseLapse.test.ts already pins the whole lapse-and-renew
 * matrix, and IdentityLicenseGates.test.ts pins the gate on every one of the
 * 44 routes - against a mounted Express app, with the licence state supplied
 * by the test. Here the refusals come from a published image that noticed its
 * own trial ending while it ran, and they are read through nginx, including
 * `location /identity` and its rewrite to /api/identity - the spelling that
 * lives in customers' identity-provider configuration.
 *
 * The assertion that carries this suite is the one about 404: a lapsed
 * ENTERPRISE stack and a COMMUNITY image both stop serving SSO and SCIM, and
 * only the status tells them apart. 404 means the routers were never mounted
 * (no enterprise module); 402 and 403 mean they are mounted and the licence
 * turned the request away. Reading the second as the first would hide a
 * mislabelled image behind "well, SSO is off either way" - and the enterprise
 * job exists to tell exactly those two apart.
 *
 * Each probe's expected answer lives beside its licensed and community ones in
 * Enterprise/Helpers/IdentityRoutes.ts, so the three suites cannot drift.
 */

test.describe("Enterprise identity routes refused through nginx (lapsed stack)", () => {
  test.beforeAll(async (): Promise<void> => {
    /*
     * Polls until the running app has noticed the lapse: its licence inputs
     * are cached for 60s and the gates read a snapshot that is served
     * synchronously while a reload runs behind it, so asserting a refusal
     * before this returns would be asserting against the old licence.
     */
    await assertLapsedEnterpriseStack();
  });

  for (const prefix of IDENTITY_PREFIXES) {
    for (const probe of IDENTITY_PROBES) {
      test(`GET ${prefix}${probe.path} - ${probe.label}`, async ({
        request,
      }: {
        request: APIRequestContext;
      }): Promise<void> => {
        const url: string = identityProbeUrl({ prefix, path: probe.path });

        // No redirects: a refusal must be the answer, not a hop to a sign-in page.
        const response: APIResponse = await request.get(url, {
          maxRedirects: 0,
        });
        const status: number = response.status();
        const body: string = await response.text();
        const found: string = `HTTP ${status} from ${url}: ${body.slice(0, 300)}`;

        expect(
          status,
          `${url} answered 404, which is the COMMUNITY Edition's answer: the ` +
            `identity routers are not mounted at all. A lapsed licence must leave ` +
            `them mounted and refuse per request - if this is a 404 the image is ` +
            `not the enterprise one, its enterprise module failed to load, or (for ` +
            `the /identity prefix) nginx stopped rewriting. ${found}`,
        ).not.toBe(404);

        expect(
          body,
          `${url} answered the catch-all "page not found" body while claiming a ` +
            `different status. ${found}`,
        ).not.toContain(PAGE_NOT_FOUND_MESSAGE_FRAGMENT);

        expect(status, `${url} answered the wrong status. ${found}`).toBe(
          probe.lapsed.status,
        );

        if (probe.lapsed.bodyContains) {
          expect(
            body,
            `${url} did not carry the licence refusal's own message, so this is ` +
              `some other refusal. ${found}`,
          ).toContain(probe.lapsed.bodyContains);
        }

        if (probe.lapsed.isScimError) {
          /*
           * RFC 7644 section 3.12. The identity provider on the other end only
           * shows its administrator a reason it can parse, and the gate goes
           * out of its way to keep this shape (LicensedFeatureGate.sendRefusal
           * bypasses the standard error envelope) - so the shape is the
           * assertion, not just the text inside it.
           */
          const parsed: Record<string, unknown> = JSON.parse(body) as Record<
            string,
            unknown
          >;
          const schemas: Array<string> = Array.isArray(parsed["schemas"])
            ? (parsed["schemas"] as Array<unknown>).map(
                (entry: unknown): string => {
                  return String(entry);
                },
              )
            : [];

          expect(
            schemas,
            `${url} must answer a SCIM error body. ${found}`,
          ).toContain(SCIM_ERROR_SCHEMA_URN);

          // A STRING, as the SCIM schema requires - not the number 403.
          expect(
            typeof parsed["status"],
            `${url} must report its status the way SCIM spells it, as a string. ${found}`,
          ).toBe("string");

          expect(
            parsed["status"],
            `${url} reported a different status inside its SCIM body than it sent. ${found}`,
          ).toBe(String(probe.lapsed.status));

          expect(
            String(parsed["detail"]),
            `${url} must explain the refusal in the SCIM body's detail, which is ` +
              `the only part an identity provider shows its administrator. ${found}`,
          ).toContain(probe.lapsed.bodyContains);
        }
      });
    }
  }

  for (const prefix of IDENTITY_PREFIXES) {
    test(`GET ${prefix}${SSO_LOGIN_PAGE_PATH} - a browser SSO login renders the message view`, async ({
      request,
    }: {
      request: APIRequestContext;
    }): Promise<void> => {
      const url: string = identityProbeUrl({
        prefix,
        path: SSO_LOGIN_PAGE_PATH,
      });

      const response: APIResponse = await request.get(url, {
        maxRedirects: 0,
      });
      const status: number = response.status();
      const body: string = await response.text();
      const found: string = `HTTP ${status} from ${url}: ${body.slice(0, 300)}`;

      expect(
        status,
        `${url} answered 404: the browser SSO routes are not mounted, so this is ` +
          `not an Enterprise image with a lapsed licence. ${found}`,
      ).not.toBe(404);

      // PaymentRequired, as the JSON discovery routes answer - but rendered.
      expect(status, `${url} answered the wrong status. ${found}`).toBe(402);

      /*
       * A person started this request by clicking "Sign in with SSO", so the
       * gate renders the Identity message view instead of answering JSON
       * (LicensedFeatureGate.forSsoPage -> FeatureSet/Identity/Views/
       * Message.ejs). The server-rendered HTML is the whole proof: its <title>
       * and heading carry the title, and its paragraph tells the person what
       * to do next instead of leaving them at a bare error.
       */
      expect(
        body,
        `${url} answered something that is not a rendered page. A browser SSO ` +
          `route must not fall back to the JSON refusal: a person is looking at ` +
          `this. ${found}`,
      ).toContain("<html");

      expect(
        body,
        `${url} must render the Identity message view. ${found}`,
      ).toContain(SSO_UNAVAILABLE_TITLE);

      expect(
        body,
        `${url} rendered a page that does not tell the person how to sign in ` +
          `while the licence is lapsed. ${found}`,
      ).toContain(SSO_UNAVAILABLE_PAGE_ADVICE_FRAGMENT);
    });
  }
});
