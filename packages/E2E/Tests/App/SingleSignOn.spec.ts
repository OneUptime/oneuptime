import { IS_BILLING_ENABLED } from "../../Config";
import {
  StackFrontendEnvironment,
  fetchStackFrontendEnvironment,
} from "../../Enterprise/Helpers/FrontendEnvironment";
import {
  EnterpriseLicenseState,
  fetchEnterpriseLicenseState,
} from "../../Enterprise/Helpers/LicenseState";
import {
  SignedUpOwner,
  createProjectAsOwner,
  signUpOwnerWithProject,
} from "../Helpers/ApiSignup";
import {
  expectRequireSsoForLoginEnforced,
  expectSamlProviderAccepted,
  expectSamlProviderOffered,
  expectSamlStartRedirectsToProvider,
} from "../Helpers/SsoConfiguration";
import {
  IDENTITY_PREFIXES,
  RAISED_PREFIX_SSO_PROBES,
  SSO_ROUTE_PROBES,
  SsoRouteResponse,
  describeSsoRouteProbe,
  expectSsoRouteAnswer,
  sendSsoRouteProbe,
} from "../Helpers/SsoRoutes";
import {
  APIRequestContext,
  request as playwrightRequest,
  test,
} from "@playwright/test";
import Faker from "Common/Utils/Faker";

/*
 * SINGLE SIGN-ON IS CORE: every stack serves it, and no edition or licence
 * decides whether it works.
 *
 * SAML and OIDC sign-in - for projects, for the whole instance and for
 * status pages - and "Require SSO for login" are part of the Community
 * Edition. This spec is in the default ./Tests tree, which runs against the
 * Community stack (test-e2e-test-self-hosted) and the SaaS stack
 * (test-e2e-test-saas), so both prove it here; the self-hosted Enterprise
 * stack proves it in its own focused suites, before its licence lapses
 * (Enterprise/Licensed/IdentityRoutesThroughNginx.spec.ts) and after
 * (Enterprise/Lapsed/SsoUnaffectedByLapse.spec.ts).
 *
 * Two halves:
 *
 *   1. Every core SSO route answers through nginx, on both identity prefixes
 *      and on the status page's own prefix, with the one answer
 *      Tests/Helpers/SsoRoutes.ts pins for every stack. No skip: the answers
 *      are the same with billing on.
 *   2. With billing off, SSO works end to end for a brand new project owner:
 *      a SAML provider can be configured, both sign-in listings offer it, its
 *      start route sends the browser to the identity provider, and "Require
 *      SSO for login" can be switched on and is enforced
 *      (Tests/Helpers/SsoConfiguration.ts). Skipped with billing on, where
 *      OneUptime Cloud sells SSO configuration on the Scale plan and a new
 *      project is below it.
 *
 * API only, never a page navigation: the default suite runs in two browsers
 * and is already near the 90-minute ceiling its config says must be read as a
 * hang. Everything here is a plain HTTP request.
 */

const BILLING_SKIP_REASON: string =
  "Billing is on: OneUptime Cloud sells SSO configuration on the Scale plan " +
  "(@TableBillingAccessControl on ProjectSso and Project.requireSsoForLogin), " +
  "and a new project is below it. The routes above still ran.";

test.describe("Single sign-on routes answer on every stack", () => {
  for (const prefix of IDENTITY_PREFIXES) {
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

test.describe("Single sign-on is configured and used end to end (billing off)", () => {
  test.describe.configure({ mode: "serial" });

  /*
   * One request context for the whole flow: its cookie jar holds the session
   * the sign-up creates, so every call below is the same signed-in owner. On
   * a shared object rather than in `let`s, like the other serial specs.
   */
  const shared: {
    request: APIRequestContext | null;
    owner: SignedUpOwner;
    projectSsoId: string;
    billingEnabled: boolean;
    where: string;
  } = {
    request: null,
    owner: { ownerEmail: "", projectId: "" },
    projectSsoId: "",
    billingEnabled: false,
    where: "",
  };

  test.beforeAll(async (): Promise<void> => {
    test.setTimeout(120000);

    /*
     * Billing as the STACK reports it (the Dashboard's env.js), or as this
     * run was told: either one on means the plan, not the edition, decides
     * whether a project may configure SSO.
     */
    const environment: StackFrontendEnvironment =
      await fetchStackFrontendEnvironment();

    shared.billingEnabled = IS_BILLING_ENABLED || environment.billingEnabled;

    if (shared.billingEnabled) {
      // Every test below skips; do not spend a sign-up on this stack.
      return;
    }

    const licenseState: EnterpriseLicenseState =
      await fetchEnterpriseLicenseState();

    shared.where = `on this ${licenseState.edition || "unknown"} edition stack`;

    shared.request = await playwrightRequest.newContext();
    shared.owner = await signUpOwnerWithProject({
      request: shared.request,
      name: "E2E Single Sign-On",
    });
  });

  test.beforeEach((): void => {
    test.skip(shared.billingEnabled, BILLING_SKIP_REASON);
  });

  test.afterAll(async (): Promise<void> => {
    await shared.request?.dispose();
  });

  test("a project owner can configure a SAML provider", async (): Promise<void> => {
    shared.projectSsoId = await expectSamlProviderAccepted({
      request: shared.request!,
      projectId: shared.owner.projectId,
      where: shared.where,
    });
  });

  test("both sign-in listings offer the provider", async (): Promise<void> => {
    await expectSamlProviderOffered({
      request: shared.request!,
      projectId: shared.owner.projectId,
      projectSsoId: shared.projectSsoId,
      ownerEmail: shared.owner.ownerEmail,
      where: shared.where,
    });
  });

  test("signing in with SSO sends the browser to the identity provider", async (): Promise<void> => {
    await expectSamlStartRedirectsToProvider({
      request: shared.request!,
      projectId: shared.owner.projectId,
      projectSsoId: shared.projectSsoId,
      where: shared.where,
    });
  });

  test("Require SSO for login can be switched on, and is enforced", async (): Promise<void> => {
    /*
     * A second project, because switching the requirement on locks this
     * password-signed-in owner out of the project it is switched on for.
     */
    const ssoProjectId: string = await createProjectAsOwner({
      request: shared.request!,
      name: `E2E Require SSO ${Faker.generateName().toString()}`,
    });

    await expectRequireSsoForLoginEnforced({
      request: shared.request!,
      ssoProjectId,
      openProjectId: shared.owner.projectId,
      where: shared.where,
    });
  });
});
