import {
  IDENTITY_PREFIXES,
  PAGE_NOT_FOUND_MESSAGE_FRAGMENT,
  RAISED_PREFIX_SSO_PROBES,
  SSO_ROUTE_PROBES,
  SsoRouteResponse,
  describeSsoRouteProbe,
  expectSsoRouteAnswer,
  identityRouteUrl,
  sendSsoRouteProbe,
} from "../../Tests/Helpers/SsoRoutes";
import { SCIM_PROBES } from "../Helpers/IdentityRoutes";
import { assertLicensedEnterpriseStack } from "../Helpers/StackGuard";
import { APIRequestContext, APIResponse, expect, test } from "@playwright/test";

/*
 * The identity routes, served through nginx by the published enterprise
 * image with billing off: the Enterprise Edition's SCIM routes, and core's
 * single sign-on routes beside them.
 *
 * What this proves that the jest suites cannot: the routes are pinned and
 * driven over real HTTP in-process - the 20 single sign-on routes, which are
 * core, by packages/App/Tests/FeatureSet/Identity/
 * SsoRoutePathsUnchanged.test.ts and SsoRoutesServedInEveryEdition.test.ts;
 * the 26 SCIM routes, which are the Enterprise Edition's, by
 * ee/Tests/Server/Identity/RoutePathsUnchanged.test.ts,
 * IdentityLicenseGates.test.ts and IdentityRoutesServed.test.ts. All of them
 * mount Express directly. None of them goes through nginx - and
 * `location /identity`, which rewrites ^/identity(.*)$ to /api/identity$1,
 * is the spelling that customers' identity providers have in their ACS,
 * redirect and SCIM URLs. A dropped rewrite breaks every existing SSO and
 * SCIM deployment while the whole jest suite stays green. That rewrite, on a
 * real image, is what this spec covers.
 *
 * SCIM probes assert their EXACT licensed status, and separately that the
 * answer is neither a 404 nor a licence refusal, because those three outcomes
 * are three different bugs: 404 means the enterprise module is not loaded at
 * all (a community image, or a failed load), 403 means it is loaded and the
 * licence stopped the route, and the expected status means the route ran.
 *
 * Single sign-on probes assert the one answer every stack gives
 * (Tests/Helpers/SsoRoutes.ts): loading the enterprise module must neither
 * hide nor shadow a single core route.
 */

test.describe("Identity routes through nginx (licensed stack)", () => {
  test.beforeAll(async (): Promise<void> => {
    await assertLicensedEnterpriseStack();
  });

  for (const prefix of IDENTITY_PREFIXES) {
    for (const probe of SCIM_PROBES) {
      test(`GET ${prefix}${probe.path} - ${probe.label}`, async ({
        request,
      }: {
        request: APIRequestContext;
      }): Promise<void> => {
        const url: string = identityRouteUrl({ prefix, path: probe.path });

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
            `route exists; a 404 means the SCIM routers were never mounted - the ` +
            `Community image, a failed enterprise load, or (for the /identity prefix) ` +
            `a broken nginx rewrite. ${found}`,
        ).not.toBe(404);

        expect(
          body,
          `${url} answered the App's catch-all "page not found" body. ${found}`,
        ).not.toContain(PAGE_NOT_FOUND_MESSAGE_FRAGMENT);

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
      });
    }

    for (const probe of SSO_ROUTE_PROBES) {
      test(
        describeSsoRouteProbe({ prefix, probe }),
        async ({ request }: { request: APIRequestContext }): Promise<void> => {
          const response: SsoRouteResponse = await sendSsoRouteProbe({
            request,
            prefix,
            probe,
          });

          expectSsoRouteAnswer({ probe, response });
        },
      );
    }
  }

  for (const probe of RAISED_PREFIX_SSO_PROBES) {
    test(
      describeSsoRouteProbe({ prefix: "", probe }),
      async ({ request }: { request: APIRequestContext }): Promise<void> => {
        const response: SsoRouteResponse = await sendSsoRouteProbe({
          request,
          prefix: "",
          probe,
        });

        expectSsoRouteAnswer({ probe, response });
      },
    );
  }
});
