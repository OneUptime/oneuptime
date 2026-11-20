import SignInManagementUtil, {
  MAX_LOCAL_SIGN_IN_PROJECT_NAMES,
  MAX_PROJECT_NAME_LENGTH,
  MAX_SSO_PROVIDER_NAME_LENGTH,
  MAX_SSO_PROVIDER_NAMES,
  SIGN_IN_MANAGEMENT_API_ROUTE,
  SignInManagement,
  SSO_MANAGED_SIGN_IN_MESSAGE,
  SsoManagedBy,
} from "../../../Types/SSO/SsoManagedSignIn";
import { describe, expect, test } from "@jest/globals";

/*
 * What User Profile makes of GET /user/sign-in-management (issue #9688):
 * whether the person's organization manages how they sign in, and the
 * providers to name. A broken answer must never hide the Security pages from
 * somebody whose own settings they are - the server refuses what it must
 * either way - and a forged one must never draw a wall of text.
 */

describe("SignInManagementUtil.parse", () => {
  test("reads a managed answer with the providers it names", () => {
    expect(
      SignInManagementUtil.parse({
        isManagedBySso: true,
        ssoProviderNames: ["Okta", "Microsoft Entra ID"],
      }),
    ).toEqual({
      isManagedBySso: true,
      ssoProviderNames: ["Okta", "Microsoft Entra ID"],
      localSignInProjectNames: [],
    } as SignInManagement);
  });

  test("reads a managed answer that names no provider", () => {
    expect(
      SignInManagementUtil.parse({
        isManagedBySso: true,
        ssoProviderNames: [],
      }),
    ).toEqual({
      isManagedBySso: true,
      ssoProviderNames: [],
      localSignInProjectNames: [],
    });

    expect(SignInManagementUtil.parse({ isManagedBySso: true })).toEqual({
      isManagedBySso: true,
      ssoProviderNames: [],
      localSignInProjectNames: [],
    });
  });

  test("an answer that is not managed carries no names, whatever it sends", () => {
    expect(
      SignInManagementUtil.parse({
        isManagedBySso: false,
        ssoProviderNames: ["Okta"],
      }),
    ).toEqual({
      isManagedBySso: false,
      ssoProviderNames: [],
      localSignInProjectNames: [],
    });
  });

  test("someone some of whose projects manage sign-in is told which projects keep their settings, with the providers of the others (#9763)", () => {
    expect(
      SignInManagementUtil.parse({
        isManagedBySso: false,
        ssoProviderNames: ["Okta"],
        localSignInProjectNames: ["Contractors", "Globex"],
      }),
    ).toEqual({
      isManagedBySso: false,
      ssoProviderNames: ["Okta"],
      localSignInProjectNames: ["Contractors", "Globex"],
    });
  });

  test("a managed answer carries no projects that keep settings: there are none", () => {
    expect(
      SignInManagementUtil.parse({
        isManagedBySso: true,
        ssoProviderNames: ["Okta"],
        localSignInProjectNames: ["Contractors"],
      }),
    ).toEqual({
      isManagedBySso: true,
      ssoProviderNames: ["Okta"],
      localSignInProjectNames: [],
    });
  });

  test.each([
    ["no list", undefined],
    ["a list of nothing", []],
    ["a string", "Contractors"],
    ["names that are not names", ["", "  ", 7, null]],
  ])(
    "an answer that is not managed and names no project (%s) carries no providers either",
    (_label: string, localSignInProjectNames: unknown) => {
      expect(
        SignInManagementUtil.parse({
          isManagedBySso: false,
          ssoProviderNames: ["Okta"],
          localSignInProjectNames: localSignInProjectNames,
        }),
      ).toEqual({
        isManagedBySso: false,
        ssoProviderNames: [],
        localSignInProjectNames: [],
      });
    },
  );

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["a string", "managed"],
    ["an array", [true]],
    ["a proxy's page", "<html>502 Bad Gateway</html>"],
    ["no flag", { ssoProviderNames: ["Okta"] }],
    ["a flag that is a string", { isManagedBySso: "true" }],
    ["a flag that is a number", { isManagedBySso: 1 }],
  ])("%s is no answer", (_label: string, value: unknown) => {
    expect(SignInManagementUtil.parse(value)).toBeNull();
  });
});

describe("SignInManagementUtil.readProviderNames", () => {
  test("keeps each name once, trimmed, in the order given", () => {
    expect(
      SignInManagementUtil.readProviderNames([
        "  Okta  ",
        "okta",
        "Microsoft Entra ID",
        "OKTA",
      ]),
    ).toEqual(["Okta", "Microsoft Entra ID"]);
  });

  test("leaves out what is not a name", () => {
    expect(
      SignInManagementUtil.readProviderNames([
        "",
        "   ",
        42,
        null,
        { name: "Okta" },
        ["Okta"],
        "Google Workspace",
      ]),
    ).toEqual(["Google Workspace"]);
  });

  test("is empty for anything that is not a list", () => {
    expect(SignInManagementUtil.readProviderNames("Okta")).toEqual([]);
    expect(SignInManagementUtil.readProviderNames(undefined)).toEqual([]);
    expect(SignInManagementUtil.readProviderNames({ 0: "Okta" })).toEqual([]);
  });

  test("cuts a name that is too long, and stops at the most it lists", () => {
    const long: string = "N".repeat(MAX_SSO_PROVIDER_NAME_LENGTH + 50);

    expect(SignInManagementUtil.readProviderNames([long])).toEqual([
      "N".repeat(MAX_SSO_PROVIDER_NAME_LENGTH),
    ]);

    const many: Array<string> = Array.from(
      { length: MAX_SSO_PROVIDER_NAMES + 5 },
      (_value: unknown, index: number): string => {
        return `Provider ${index}`;
      },
    );

    expect(SignInManagementUtil.readProviderNames(many)).toEqual(
      many.slice(0, MAX_SSO_PROVIDER_NAMES),
    );
  });
});

describe("SignInManagementUtil.readProjectNames", () => {
  test("keeps each project's name once, trimmed, in the order given", () => {
    expect(
      SignInManagementUtil.readProjectNames([
        "  Contractors ",
        "contractors",
        "Globex",
        42,
        "",
      ]),
    ).toEqual(["Contractors", "Globex"]);
  });

  test("cuts a name that is too long, and stops at the most it lists", () => {
    const long: string = "P".repeat(MAX_PROJECT_NAME_LENGTH + 20);

    expect(SignInManagementUtil.readProjectNames([long])).toEqual([
      "P".repeat(MAX_PROJECT_NAME_LENGTH),
    ]);

    const many: Array<string> = Array.from(
      { length: MAX_LOCAL_SIGN_IN_PROJECT_NAMES + 3 },
      (_value: unknown, index: number): string => {
        return `Project ${index}`;
      },
    );

    expect(SignInManagementUtil.readProjectNames(many)).toEqual(
      many.slice(0, MAX_LOCAL_SIGN_IN_PROJECT_NAMES),
    );
  });

  test("is empty for anything that is not a list", () => {
    expect(SignInManagementUtil.readProjectNames("Globex")).toEqual([]);
    expect(SignInManagementUtil.readProjectNames(null)).toEqual([]);
  });
});

describe("the words and the route", () => {
  test("the refusal says why, names SSO and says who manages it, for the server's requirement and a project's alike", () => {
    expect(SSO_MANAGED_SIGN_IN_MESSAGE).toBe(
      "Your organization signs you in with single sign-on (SSO), so your password, passkeys and two-factor authentication are managed by your identity provider, not by OneUptime.",
    );
    // A sentence: a capital letter first and a full stop last.
    expect(SSO_MANAGED_SIGN_IN_MESSAGE).toMatch(/^[A-Z].*\.$/);
    // Not "this server": a project's requirement covers people too (#9763).
    expect(SSO_MANAGED_SIGN_IN_MESSAGE).not.toMatch(/server/i);
  });

  test("why someone is covered is the server's requirement or their projects'", () => {
    expect(Object.values(SsoManagedBy).sort()).toEqual(["Projects", "Server"]);
  });

  test("the profile asks the route the API serves", () => {
    expect(SIGN_IN_MANAGEMENT_API_ROUTE).toBe("/user/sign-in-management");
  });
});
