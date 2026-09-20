import {
  IDENTITY_PREFIXES,
  IDENTITY_PROBES,
  identityProbeUrl,
} from "../Helpers/IdentityRoutes";
import { assertLicensedEnterpriseStack } from "../Helpers/StackGuard";
import { APIRequestContext, APIResponse, expect, test } from "@playwright/test";

/*
 * The enterprise identity surface, served through nginx by the published
 * enterprise image with billing off.
 *
 * What this proves that the jest suites cannot: ee/Tests/Server/Identity/
 * IdentityRoutesServed.test.ts already drives every one of the 44 identity
 * routes over real HTTP on both mount prefixes, and IdentityLicenseGates /
 * IdentityRoutesLicenseLapse pin every gate and the whole lapse-and-renew
 * matrix. All of them mount Express directly. None of them goes through
 * nginx - and `location /identity`, which rewrites ^/identity(.*)$ to
 * /api/identity$1, is the spelling that customers' identity providers have in
 * their ACS, redirect and SCIM URLs. A dropped rewrite breaks every existing
 * SSO deployment while the whole jest suite stays green. That rewrite, on a
 * real image, is what this spec covers.
 *
 * Each probe asserts an EXACT status, and separately that the answer is
 * neither a 404 nor a licence refusal, because those three outcomes are three
 * different bugs: 404 means the enterprise module is not loaded at all (a
 * community image, or a failed load), 402/403 mean it is loaded and the
 * licence stopped the route, and the expected status means the route ran.
 */

test.describe("Enterprise identity routes through nginx (licensed stack)", () => {
  test.beforeAll(async (): Promise<void> => {
    await assertLicensedEnterpriseStack();
  });

  for (const prefix of IDENTITY_PREFIXES) {
    for (const probe of IDENTITY_PROBES) {
      test(`GET ${prefix}${probe.path} - ${probe.label}`, async ({
        request,
      }: {
        request: APIRequestContext;
      }): Promise<void> => {
        const url: string = identityProbeUrl({ prefix, path: probe.path });

        /*
         * No redirects: a route that answered by redirecting somewhere that
         * happens to return 200 would otherwise read as a pass.
         */
        const response: APIResponse = await request.get(url, {
          maxRedirects: 0,
        });
        const status: number = response.status();
        const body: string = await response.text();
        const found: string = `HTTP ${status} from ${url}: ${body.slice(0, 300)}`;

        expect(
          status,
          `${url} answered 404. On a stack that loaded its enterprise module this ` +
            `route exists; a 404 means the identity routers were never mounted - the ` +
            `Community image, a failed enterprise load, or (for the /identity prefix) ` +
            `a broken nginx rewrite. ${found}`,
        ).not.toBe(404);

        expect(
          [402, 403],
          `${url} was refused by the licence gate. That is the LAPSED stack's answer; ` +
            `this suite runs against a stack whose licence is usable. ${found}`,
        ).not.toContain(status);

        expect(status, `${url} answered the wrong status. ${found}`).toBe(
          probe.licensed.status,
        );

        if (probe.licensed.bodyContains) {
          expect(body, `${url} answered the wrong body. ${found}`).toContain(
            probe.licensed.bodyContains,
          );
        }

        if (probe.licensed.isEntityArray) {
          const parsed: Record<string, unknown> = JSON.parse(body) as Record<
            string,
            unknown
          >;

          /*
           * The discovery route really ran and listed providers (none are
           * configured on a fresh stack, so the array is empty - the point is
           * that it is an array and not a refusal).
           */
          expect(
            Array.isArray(parsed["data"]),
            `${url} must answer a JSON entity array. ${found}`,
          ).toBe(true);
        }
      });
    }
  }
});
