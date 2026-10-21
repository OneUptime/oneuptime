import {
  SignedUpOwner,
  createProjectAsOwner,
  signUpOwnerWithProject,
} from "../../Tests/Helpers/ApiSignup";
import {
  expectRequireSsoForLoginEnforced,
  expectSamlProviderAccepted,
  expectSamlProviderOffered,
  expectSamlStartRedirectsToProvider,
} from "../../Tests/Helpers/SsoConfiguration";
import {
  IDENTITY_PREFIXES,
  RAISED_PREFIX_SSO_PROBES,
  SSO_ROUTE_PROBES,
  SsoRouteResponse,
  describeSsoRouteProbe,
  expectSsoRouteAnswer,
  sendSsoRouteProbe,
} from "../../Tests/Helpers/SsoRoutes";
import { assertLapsedEnterpriseStack } from "../Helpers/StackGuard";
import {
  APIRequestContext,
  request as playwrightRequest,
  test,
} from "@playwright/test";
import Faker from "Common/Utils/Faker";

/*
 * A lapsed Enterprise licence does not touch single sign-on.
 *
 * SAML and OIDC sign-in and "Require SSO for login" are core: no edition and
 * no licence decides whether they work. When the licence lapses, SCIM and
 * audit logging stop (the other specs beside this one) - and single sign-on
 * keeps doing exactly what it did in the licensed phase. This spec proves it
 * on the stack whose licence just lapsed, the one place a regression that
 * tied SSO to the licence would show:
 *
 *   1. every core SSO route answers through nginx exactly as on every other
 *      stack (Tests/Helpers/SsoRoutes.ts) - in particular a browser sign-in
 *      start still reaches its route and gets its own JSON answer, never a
 *      402 or a rendered refusal page;
 *   2. a project owner can still configure a SAML provider, the sign-in
 *      listings offer it, its start route sends the browser to the identity
 *      provider, and "Require SSO for login" can be switched on and is
 *      enforced (Tests/Helpers/SsoConfiguration.ts, the same steps the
 *      Community stack runs in Tests/App/SingleSignOn.spec.ts).
 *
 * It signs its own owner up rather than borrowing the licensed phase's
 * handoff project: the provider it enables and the project it locks behind
 * "Require SSO for login" must not change what the other lapsed specs do with
 * that project - EnterpriseWritesAndAuditRecorder signs its owner in with a
 * password.
 */

test.describe("Single sign-on routes answer as on every stack (lapsed stack)", () => {
  test.beforeAll(async (): Promise<void> => {
    /*
     * Polls until the running app has noticed the lapse, so every answer
     * below is read from a process that already treats the licence as dead.
     */
    await assertLapsedEnterpriseStack();
  });

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

test.describe("Single sign-on is configured and used end to end (lapsed stack)", () => {
  test.describe.configure({ mode: "serial" });

  const WHERE: string = "while the Enterprise licence is lapsed";

  /*
   * One request context for the whole flow: its cookie jar holds the session
   * the sign-up creates. On a shared object rather than in `let`s, like the
   * other serial specs.
   */
  const shared: {
    request: APIRequestContext | null;
    owner: SignedUpOwner;
    projectSsoId: string;
  } = {
    request: null,
    owner: { ownerEmail: "", projectId: "" },
    projectSsoId: "",
  };

  test.beforeAll(async (): Promise<void> => {
    test.setTimeout(300000);

    await assertLapsedEnterpriseStack();

    /*
     * Signing up and creating a project are core, so they work with a dead
     * licence - which is itself part of what a lapse must leave alone.
     */
    shared.request = await playwrightRequest.newContext();
    shared.owner = await signUpOwnerWithProject({
      request: shared.request,
      name: "E2E Lapsed Single Sign-On",
    });
  });

  test.afterAll(async (): Promise<void> => {
    await shared.request?.dispose();
  });

  test("a project owner can still configure a SAML provider", async (): Promise<void> => {
    shared.projectSsoId = await expectSamlProviderAccepted({
      request: shared.request!,
      projectId: shared.owner.projectId,
      where: WHERE,
    });
  });

  test("both sign-in listings still offer the provider", async (): Promise<void> => {
    await expectSamlProviderOffered({
      request: shared.request!,
      projectId: shared.owner.projectId,
      projectSsoId: shared.projectSsoId,
      ownerEmail: shared.owner.ownerEmail,
      where: WHERE,
    });
  });

  test("signing in with SSO still sends the browser to the identity provider", async (): Promise<void> => {
    await expectSamlStartRedirectsToProvider({
      request: shared.request!,
      projectId: shared.owner.projectId,
      projectSsoId: shared.projectSsoId,
      where: WHERE,
    });
  });

  test("Require SSO for login can still be switched on, and is enforced", async (): Promise<void> => {
    /*
     * A second project, because switching the requirement on locks this
     * password-signed-in owner out of the project it is switched on for.
     */
    const ssoProjectId: string = await createProjectAsOwner({
      request: shared.request!,
      name: `E2E Lapsed Require SSO ${Faker.generateName().toString()}`,
    });

    await expectRequireSsoForLoginEnforced({
      request: shared.request!,
      ssoProjectId,
      openProjectId: shared.owner.projectId,
      where: WHERE,
    });
  });
});
