import SignInMethodsUtil, {
  GLOBAL_SSO_PROVIDER_TYPES,
  MASTER_ADMIN_SIGN_IN_PATH,
  MASTER_ADMIN_SIGN_IN_ROUTE,
  PROJECT_SSO_PROVIDER_TYPES,
  SignInMethods,
  SSO_REQUIRED_SIGN_IN_MESSAGE,
  SSO_REQUIRED_SIGN_UP_MESSAGE,
  SsoSignInProvider,
} from "../../../Types/SSO/SignInMethods";
import SsoProviderType from "../../../Types/SSO/SsoProviderType";
import { describe, expect, test } from "@jest/globals";

/*
 * What a sign-in page makes of the server's answer about how it signs people
 * in (GET /identity/sign-in-methods and its project twin), and where a
 * provider's sign-in starts. A broken or forged answer must never draw a
 * button that cannot work, nor make a page that requires SSO look like one
 * that does not.
 */

const PROVIDER_ID: string = "11111111-1111-4111-8111-111111111111";
const OTHER_ID: string = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID: string = "33333333-3333-4333-8333-333333333333";

const provider: (
  type: SsoProviderType,
  overrides?: Partial<SsoSignInProvider>,
) => SsoSignInProvider = (
  type: SsoProviderType,
  overrides?: Partial<SsoSignInProvider>,
): SsoSignInProvider => {
  return {
    type: type,
    id: PROVIDER_ID,
    name: "Okta",
    description: "Sign in with Okta",
    ...overrides,
  };
};

describe("SignInMethodsUtil.parse", () => {
  test("reads an answer of a server that requires SSO", () => {
    const methods: SignInMethods | null = SignInMethodsUtil.parse({
      isSsoRequired: true,
      ssoProviders: [
        provider(SsoProviderType.GlobalSSO),
        provider(SsoProviderType.GlobalOIDC, {
          id: OTHER_ID,
          name: "Google",
          description: "",
        }),
      ],
      hasProjectSsoProviders: true,
    });

    expect(methods).toEqual({
      isSsoRequired: true,
      ssoProviders: [
        provider(SsoProviderType.GlobalSSO),
        provider(SsoProviderType.GlobalOIDC, {
          id: OTHER_ID,
          name: "Google",
          description: "",
        }),
      ],
      hasProjectSsoProviders: true,
    });
  });

  // Not something a page can act on: it shows what it shows when nothing is known.
  test.each([
    ["nothing", undefined],
    ["null", null],
    ["a list (a proxy's answer, an older route)", []],
    ["text", "<html>Bad gateway</html>"],
    ["an object without the rule", { ssoProviders: [] }],
    ["a rule that is not a yes or no", { isSsoRequired: "true" }],
  ])("is null for %s", (_name: string, value: unknown) => {
    expect(SignInMethodsUtil.parse(value)).toBeNull();
  });

  // Only while SSO is required does the server say it; anything else is no.
  test("never says a project has a provider while SSO is not required", () => {
    expect(
      SignInMethodsUtil.parse({
        isSsoRequired: false,
        ssoProviders: [],
        hasProjectSsoProviders: true,
      })?.hasProjectSsoProviders,
    ).toBe(false);
    expect(
      SignInMethodsUtil.parse({
        isSsoRequired: true,
        ssoProviders: [],
        hasProjectSsoProviders: "yes",
      })?.hasProjectSsoProviders,
    ).toBe(false);
  });

  // The instance-wide list holds instance-wide providers: a project's is found by email.
  test("keeps only instance-wide providers in the server's list", () => {
    const methods: SignInMethods | null = SignInMethodsUtil.parse({
      isSsoRequired: true,
      ssoProviders: [
        provider(SsoProviderType.ProjectSSO),
        provider(SsoProviderType.GlobalOIDC, { id: OTHER_ID }),
      ],
    });

    expect(
      methods?.ssoProviders.map((item: SsoSignInProvider) => {
        return item.type;
      }),
    ).toEqual([SsoProviderType.GlobalOIDC]);
  });
});

describe("SignInMethodsUtil.parseProviders", () => {
  test("leaves out anything that would be a button that cannot work", () => {
    const providers: Array<SsoSignInProvider> =
      SignInMethodsUtil.parseProviders([
        provider(SsoProviderType.GlobalSSO),
        // An id that is not one.
        provider(SsoProviderType.GlobalSSO, { id: "../../admin" }),
        // No name.
        provider(SsoProviderType.GlobalOIDC, { id: OTHER_ID, name: "  " }),
        // A kind no page starts.
        { type: "Ldap", id: OTHER_ID, name: "LDAP" },
        // Not a row.
        "Okta",
        null,
        [],
        // The same provider twice.
        provider(SsoProviderType.GlobalSSO),
      ]);

    expect(providers).toEqual([provider(SsoProviderType.GlobalSSO)]);
  });

  test("is empty for anything but a list", () => {
    expect(SignInMethodsUtil.parseProviders(undefined)).toEqual([]);
    expect(SignInMethodsUtil.parseProviders({ id: PROVIDER_ID })).toEqual([]);
    expect(SignInMethodsUtil.parseProviders("Okta")).toEqual([]);
  });

  test("trims names and descriptions, and holds them to 500 characters", () => {
    const [read] = SignInMethodsUtil.parseProviders([
      provider(SsoProviderType.GlobalSSO, {
        name: `  ${"N".repeat(600)}  `,
        description: undefined as unknown as string,
      }),
    ]);

    expect(read?.name).toHaveLength(500);
    expect(read?.description).toBe("");
  });

  test("reads the kinds asked for", () => {
    expect(
      SignInMethodsUtil.parseProviders(
        [
          provider(SsoProviderType.ProjectOIDC),
          provider(SsoProviderType.GlobalSSO, { id: OTHER_ID }),
        ],
        PROJECT_SSO_PROVIDER_TYPES,
      ),
    ).toEqual([provider(SsoProviderType.ProjectOIDC)]);
    expect([...GLOBAL_SSO_PROVIDER_TYPES].sort()).toEqual(
      [SsoProviderType.GlobalOIDC, SsoProviderType.GlobalSSO].sort(),
    );
  });

  test("a project's answer reads every kind", () => {
    expect(
      SignInMethodsUtil.parseProjectMethods({
        ssoProviders: [
          provider(SsoProviderType.ProjectSSO),
          provider(SsoProviderType.GlobalOIDC, { id: OTHER_ID }),
        ],
      }).ssoProviders,
    ).toHaveLength(2);
    expect(SignInMethodsUtil.parseProjectMethods([]).ssoProviders).toEqual([]);
    expect(SignInMethodsUtil.parseProjectMethods(null).ssoProviders).toEqual(
      [],
    );
  });
});

describe("SignInMethodsUtil.getSignInRoute", () => {
  // The identity server's start routes (Identity/API/GlobalSSO, GlobalOIDC, SSO, OIDC).
  test("starts each kind at its own route", () => {
    expect(
      SignInMethodsUtil.getSignInRoute({
        provider: provider(SsoProviderType.GlobalSSO),
      }),
    ).toBe(`/global-sso/${PROVIDER_ID}`);
    expect(
      SignInMethodsUtil.getSignInRoute({
        provider: provider(SsoProviderType.GlobalOIDC),
      }),
    ).toBe(`/global-oidc/${PROVIDER_ID}`);
    expect(
      SignInMethodsUtil.getSignInRoute({
        provider: provider(SsoProviderType.ProjectSSO),
        projectId: PROJECT_ID,
      }),
    ).toBe(`/sso/${PROJECT_ID}/${PROVIDER_ID}`);
    expect(
      SignInMethodsUtil.getSignInRoute({
        provider: provider(SsoProviderType.ProjectOIDC),
        projectId: PROJECT_ID,
      }),
    ).toBe(`/oidc/${PROJECT_ID}/${PROVIDER_ID}`);
  });

  test("starts no project provider without a real project id", () => {
    for (const projectId of [undefined, "", "project-1", "../x"]) {
      expect(
        SignInMethodsUtil.getSignInRoute({
          provider: provider(SsoProviderType.ProjectSSO),
          projectId: projectId,
        }),
      ).toBeNull();
    }
  });
});

describe("SignInMethodsUtil.hasOwnDescription", () => {
  // The page says "Sign in with <name>" in the reader's language instead.
  test("not for the description a provider gets from its name, or none", () => {
    expect(
      SignInMethodsUtil.hasOwnDescription(
        provider(SsoProviderType.GlobalSSO, {
          description: "Sign in with Okta",
        }),
      ),
    ).toBe(false);
    expect(
      SignInMethodsUtil.hasOwnDescription(
        provider(SsoProviderType.GlobalSSO, { description: "" }),
      ),
    ).toBe(false);
  });

  test("for a description its admin wrote", () => {
    expect(
      SignInMethodsUtil.hasOwnDescription(
        provider(SsoProviderType.GlobalSSO, {
          name: "Login with Whataburger SSO",
          description: "Use your WBHQ Email Address",
        }),
      ),
    ).toBe(true);
  });
});

describe("the words and the address every side shares", () => {
  test("the refusals say to sign in with SSO", () => {
    expect(SSO_REQUIRED_SIGN_IN_MESSAGE).toBe(
      "This server requires single sign-on (SSO). Sign in with SSO instead.",
    );
    expect(SSO_REQUIRED_SIGN_UP_MESSAGE).toMatch(/Sign in with SSO instead\.$/);
  });

  test("the master admins' sign-in is a page of the Accounts app", () => {
    expect(MASTER_ADMIN_SIGN_IN_ROUTE).toBe("/admin-login");
    expect(MASTER_ADMIN_SIGN_IN_PATH).toBe("/accounts/admin-login");
  });
});
