import {
  IDENTITY_PREFIXES,
  PAGE_NOT_FOUND_MESSAGE_FRAGMENT,
  identityRouteUrl,
} from "../../Tests/Helpers/SsoRoutes";
import { SCIM_ERROR_SCHEMA_URN, SCIM_PROBES } from "../Helpers/IdentityRoutes";
import { assertLapsedEnterpriseStack } from "../Helpers/StackGuard";
import { APIRequestContext, APIResponse, expect, test } from "@playwright/test";

/*
 * What a lapsed licence does to the Enterprise Edition's identity surface on
 * a real stack: every SCIM route still EXISTS, and every SCIM route REFUSES.
 *
 * What this proves that the jest suites cannot: ee/Tests/Server/Identity/
 * IdentityRoutesLicenseLapse.test.ts already pins the whole lapse-and-renew
 * matrix, and IdentityLicenseGates.test.ts pins the gate on every one of the
 * 26 SCIM routes - against a mounted Express app, with the licence state
 * supplied by the test. Here the refusals come from a published image that
 * noticed its own trial ending while it ran, and they are read through nginx,
 * including `location /identity` and its rewrite to /api/identity - the
 * spelling that lives in customers' identity-provider configuration.
 *
 * The assertion that carries this suite is the one about 404: a lapsed
 * ENTERPRISE stack and a COMMUNITY image both turn SCIM requests away, and
 * only the status tells them apart. 404 means the routers were never mounted
 * (no enterprise module); 403 means they are mounted and the licence turned
 * the request away. Reading the second as the first would hide a mislabelled
 * image behind "well, SCIM is off either way" - and the enterprise job exists
 * to tell exactly those two apart.
 *
 * Single sign-on is not refused: it is core, and a lapse leaves it answering
 * exactly as before (SsoUnaffectedByLapse.spec.ts beside this one).
 *
 * Each probe's expected answer lives beside its licensed and community ones in
 * Enterprise/Helpers/IdentityRoutes.ts, so the three suites cannot drift.
 */

test.describe("SCIM routes refused through nginx (lapsed stack)", () => {
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
    for (const probe of SCIM_PROBES) {
      test(`GET ${prefix}${probe.path} - ${probe.label}`, async ({
        request,
      }: {
        request: APIRequestContext;
      }): Promise<void> => {
        const url: string = identityRouteUrl({ prefix, path: probe.path });

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
            `SCIM routers are not mounted at all. A lapsed licence must leave ` +
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
});
