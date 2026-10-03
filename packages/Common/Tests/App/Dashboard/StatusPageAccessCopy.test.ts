import { describe, expect, test } from "@jest/globals";
import StatusPageAccessCopy, {
  ACCESS_CHOICE_COPY,
  ACCESS_CONFIRMATION_COPY,
  getAccessChoiceTestId,
  getIpAllowlistEntries,
  getIpAllowlistProblem,
  getNobodyCanSignInReason,
  getPlanNeededForAccess,
  getStatusPageAccessColumnsWrittenWithPassword,
  getStatusPageAccessSelect,
  getStatusPageAccessState,
  isIpAllowlistEntryValid,
  isIpAllowlistInForce,
  isPasswordRequiredInDialog,
  NobodyCanSignInReason,
  SignInMethods,
  STATUS_PAGE_ACCESS_GATED_COLUMNS,
  STATUS_PAGE_REQUIRE_SSO_COLUMN,
  StatusPageRequireSsoCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageAccessCopy";
import { getStatusPageRequireSsoConfirmation } from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageRequireSsoCard";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import HashedString from "../../../Types/HashedString";
import IP from "../../../Types/IP/IP";
import {
  STATUS_PAGE_ACCESS_CHOICES,
  StatusPageAccess,
  StatusPageAccessState,
} from "../../../Types/StatusPage/StatusPageAccess";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import { ModelSwitchConfirmation } from "../../../UI/Components/ModelSwitch/ModelSwitchRow";

/*
 * The decisions behind a status page's Access page, kept free of React
 * (Components/StatusPage/StatusPageAccessCopy): what each choice says, what
 * a move can write and so needs, who can sign in, and how the IP allowlist
 * is read - the way the server reads it.
 */

const PUBLIC: StatusPageAccessState = {
  isPublicStatusPage: true,
  enableMasterPassword: false,
  hasMasterPassword: false,
};

const SIGN_IN: StatusPageAccessState = {
  isPublicStatusPage: false,
  enableMasterPassword: false,
  hasMasterPassword: false,
};

const PASSWORD: StatusPageAccessState = {
  isPublicStatusPage: false,
  enableMasterPassword: true,
  hasMasterPassword: true,
};

describe("what the choices say", () => {
  test("each choice has a title and a sentence, and its own test id", () => {
    const ids: Set<string> = new Set<string>();

    for (const access of STATUS_PAGE_ACCESS_CHOICES) {
      expect(ACCESS_CHOICE_COPY[access].title.length).toBeGreaterThan(5);
      expect(ACCESS_CHOICE_COPY[access].description).toMatch(/\.$/);
      expect(ACCESS_CONFIRMATION_COPY[access].title).toMatch(/\?$/);
      expect(ACCESS_CONFIRMATION_COPY[access].description).toMatch(/\.$/);
      expect(
        ACCESS_CONFIRMATION_COPY[access].submitButtonText.length,
      ).toBeGreaterThan(3);
      ids.add(getAccessChoiceTestId(access));
    }

    expect(ids.size).toBe(3);
  });

  test("the three answers, in plain words", () => {
    expect(
      STATUS_PAGE_ACCESS_CHOICES.map((access: StatusPageAccess): string => {
        return ACCESS_CHOICE_COPY[access].title;
      }),
    ).toEqual([
      "Anyone with the link",
      "Only people who sign in",
      "Anyone with the password",
    ]);
    expect(StatusPageAccessCopy.cardTitle).toBe("Who can see this status page");
  });

  test("nobody-can-sign-in sentences keep the place for their link", () => {
    expect(StatusPageAccessCopy.nobodyCanSignIn).toContain("{{link}}");
    expect(StatusPageAccessCopy.nobodyCanSignInSsoRequired).toContain(
      "{{link}}",
    );
  });

  test("private users is a count, one and many", () => {
    expect(StatusPageAccessCopy.privateUsers).toEqual({
      one: "{{count}} private user",
      other: "{{count}} private users",
    });
  });

  test("the Private Users notice keeps its message, and names the way to Access", () => {
    expect(StatusPageAccessCopy.privateUsersPasswordNotice).toBe(
      "Master password is enabled for this status page. Private users authentication is disabled while the master password is active.",
    );
    expect(StatusPageAccessCopy.privateUsersPasswordNoticeAction).toBe(
      "Change access",
    );
  });
});

describe("what a status page holds, read for the rule", () => {
  test("reads the access columns and the SSO requirement only", () => {
    expect(getStatusPageAccessSelect()).toEqual({
      isPublicStatusPage: true,
      enableMasterPassword: true,
      masterPassword: true,
      requireSsoForLogin: true,
    });
  });

  test("a stored password is a set password; its hash is never needed", () => {
    const page: StatusPage = new StatusPage();
    page.isPublicStatusPage = false;
    page.enableMasterPassword = true;
    page.masterPassword = new HashedString("stored-hash", true);

    expect(getStatusPageAccessState(page)).toEqual({
      isPublicStatusPage: false,
      enableMasterPassword: true,
      hasMasterPassword: true,
    });

    const unset: StatusPage = new StatusPage();
    unset.isPublicStatusPage = true;

    expect(getStatusPageAccessState(unset).hasMasterPassword).toBe(false);
  });

  test("the gate checks every column a choice can write", () => {
    expect([...STATUS_PAGE_ACCESS_GATED_COLUMNS]).toEqual([
      "isPublicStatusPage",
      "enableMasterPassword",
      "masterPassword",
    ]);
  });
});

describe("what a move can write", () => {
  test("to the password, the password's column too: one is asked for, or offered to replace", () => {
    expect(
      getStatusPageAccessColumnsWrittenWithPassword({
        from: PUBLIC,
        to: StatusPageAccess.Password,
      }),
    ).toEqual(["isPublicStatusPage", "enableMasterPassword", "masterPassword"]);
    expect(
      getStatusPageAccessColumnsWrittenWithPassword({
        from: { ...SIGN_IN, hasMasterPassword: true },
        to: StatusPageAccess.Password,
      }),
    ).toEqual(["enableMasterPassword", "masterPassword"]);
  });

  test("to sign in or to anyone, never the password", () => {
    expect(
      getStatusPageAccessColumnsWrittenWithPassword({
        from: PASSWORD,
        to: StatusPageAccess.SignIn,
      }),
    ).toEqual(["enableMasterPassword"]);
    expect(
      getStatusPageAccessColumnsWrittenWithPassword({
        from: PASSWORD,
        to: StatusPageAccess.Anyone,
      }),
    ).toEqual(["isPublicStatusPage", "enableMasterPassword"]);
    expect(
      getStatusPageAccessColumnsWrittenWithPassword({
        from: PUBLIC,
        to: StatusPageAccess.SignIn,
      }),
    ).toEqual(["isPublicStatusPage"]);
  });

  test("the dialog requires a password only when the page has none", () => {
    expect(
      isPasswordRequiredInDialog({
        from: PUBLIC,
        to: StatusPageAccess.Password,
      }),
    ).toBe(true);
    expect(
      isPasswordRequiredInDialog({
        from: { ...SIGN_IN, hasMasterPassword: true },
        to: StatusPageAccess.Password,
      }),
    ).toBe(false);
    expect(
      isPasswordRequiredInDialog({ from: PUBLIC, to: StatusPageAccess.SignIn }),
    ).toBe(false);
  });
});

describe("the plan a move needs", () => {
  // As on OneUptime Cloud's Free plan: the public switch needs Growth.
  const onFree: (column: string) => PlanType | null = (
    column: string,
  ): PlanType | null => {
    return column === "isPublicStatusPage" ? PlanType.Growth : null;
  };

  test("going private or public names the plan of the public switch", () => {
    expect(
      getPlanNeededForAccess({
        from: PUBLIC,
        to: StatusPageAccess.SignIn,
        getPlanNeeded: onFree,
      }),
    ).toBe(PlanType.Growth);
    expect(
      getPlanNeededForAccess({
        from: PUBLIC,
        to: StatusPageAccess.Password,
        getPlanNeeded: onFree,
      }),
    ).toBe(PlanType.Growth);
    expect(
      getPlanNeededForAccess({
        from: PASSWORD,
        to: StatusPageAccess.Anyone,
        getPlanNeeded: onFree,
      }),
    ).toBe(PlanType.Growth);
  });

  test("moving between the private choices needs no plan", () => {
    expect(
      getPlanNeededForAccess({
        from: SIGN_IN,
        to: StatusPageAccess.Password,
        getPlanNeeded: onFree,
      }),
    ).toBeNull();
    expect(
      getPlanNeededForAccess({
        from: PASSWORD,
        to: StatusPageAccess.SignIn,
        getPlanNeeded: onFree,
      }),
    ).toBeNull();
  });

  test("a plan that includes everything needs nothing", () => {
    for (const from of [PUBLIC, SIGN_IN, PASSWORD]) {
      for (const to of STATUS_PAGE_ACCESS_CHOICES) {
        expect(
          getPlanNeededForAccess({
            from,
            to,
            getPlanNeeded: (): PlanType | null => {
              return null;
            },
          }),
        ).toBeNull();
      }
    }
  });
});

describe("who can sign in", () => {
  const methods: (overrides: Partial<SignInMethods>) => SignInMethods = (
    overrides: Partial<SignInMethods>,
  ): SignInMethods => {
    return {
      privateUsers: 0,
      enabledSsoProviders: 0,
      enabledOidcProviders: 0,
      isSsoRequired: false,
      isSsoOnPlan: true,
      ...overrides,
    };
  };

  test.each([
    ["nothing set up", {}, NobodyCanSignInReason.NothingSetUp],
    ["a private user", { privateUsers: 1 }, null],
    ["an SSO provider on", { enabledSsoProviders: 1 }, null],
    ["an OIDC provider on", { enabledOidcProviders: 2 }, null],
    [
      "SSO required with private users but no provider",
      { isSsoRequired: true, privateUsers: 4 },
      NobodyCanSignInReason.SsoRequiredWithoutProvider,
    ],
    [
      "SSO required with an OIDC provider on",
      { isSsoRequired: true, enabledOidcProviders: 1 },
      null,
    ],
    ["private users that could not be read", { privateUsers: null }, null],
    ["SSO that could not be read", { enabledSsoProviders: null }, null],
    ["OIDC that could not be read", { enabledOidcProviders: null }, null],
    [
      "SSO required, and private users that could not be read",
      { isSsoRequired: true, privateUsers: null },
      NobodyCanSignInReason.SsoRequiredWithoutProvider,
    ],
  ])(
    "%s",
    (
      _label: string,
      overrides: Partial<SignInMethods>,
      expected: NobodyCanSignInReason | null,
    ) => {
      expect(getNobodyCanSignInReason(methods(overrides))).toBe(expected);
    },
  );
});

describe("the IP allowlist, read as the server reads it", () => {
  test("in force whenever the column holds anything at all", () => {
    expect(isIpAllowlistInForce(undefined)).toBe(false);
    expect(isIpAllowlistInForce(null)).toBe(false);
    expect(isIpAllowlistInForce("")).toBe(false);
    expect(isIpAllowlistInForce("203.0.113.7")).toBe(true);
    // Blank lines too: the server then lets nobody in.
    expect(isIpAllowlistInForce("\n  \n")).toBe(true);
  });

  test("entries are its lines, trimmed, blank ones left out", () => {
    expect(
      getIpAllowlistEntries(" 203.0.113.7 \r\n\n10.0.0.0/8\n  \n"),
    ).toEqual(["203.0.113.7", "10.0.0.0/8"]);
    expect(getIpAllowlistEntries(null)).toEqual([]);
  });

  test.each([
    "203.0.113.7",
    "10.0.0.0/8",
    "192.168.1.0/24",
    "10.1.2.3/32",
    "0.0.0.0/0",
    "2001:db8::1",
    "::1",
  ])("%s is an entry the server can match", (entry: string) => {
    expect(isIpAllowlistEntryValid(entry)).toBe(true);
  });

  test.each([
    "example.com",
    "10.0.0.0/33",
    "10.0.0.0/",
    "/8",
    "10.0.0/8",
    "10.0.0.0/x",
    "2001:db8::/32",
    "256.1.1.1",
    "10.0.0.1 10.0.0.2",
  ])("%s is not: the server would skip it", (entry: string) => {
    expect(isIpAllowlistEntryValid(entry)).toBe(false);

    // Whatever address visits, the server never matches it.
    for (const visitor of ["10.0.0.1", "203.0.113.7", "2001:db8::1"]) {
      expect(IP.isInWhitelist({ ip: visitor, whitelist: [entry] })).toBe(false);
    }
  });

  test("a range with a stray part is refused, though the server reads past it", () => {
    // The server reads "10.0.0.0/8/8" as 10.0.0.0/8; the list says what it means.
    expect(isIpAllowlistEntryValid("10.0.0.0/8/8")).toBe(false);
    expect(getIpAllowlistProblem("10.0.0.0/8/8")).toBe(
      "10.0.0.0/8/8 is not an IP address or an IPv4 range such as 10.0.0.0/8.",
    );
  });

  test("a valid range lets in the addresses in it, as the server does", () => {
    expect(isIpAllowlistEntryValid("10.0.0.0/8")).toBe(true);
    expect(
      IP.isInWhitelist({ ip: "10.20.30.40", whitelist: ["10.0.0.0/8"] }),
    ).toBe(true);
    expect(
      IP.isInWhitelist({ ip: "11.0.0.1", whitelist: ["10.0.0.0/8"] }),
    ).toBe(false);
  });

  test("an empty list saves: every address may open the page", () => {
    expect(getIpAllowlistProblem("")).toBeNull();
    expect(getIpAllowlistProblem(undefined)).toBeNull();
  });

  test("a list of readable entries saves", () => {
    expect(
      getIpAllowlistProblem("203.0.113.7\n10.0.0.0/8\n2001:db8::1\n"),
    ).toBeNull();
  });

  test("a list of blank lines does not: it would let nobody in", () => {
    expect(getIpAllowlistProblem("\n   \n")).toBe(
      StatusPageAccessCopy.ipAllowlistBlank,
    );
  });

  test("a line the server cannot read is named", () => {
    expect(getIpAllowlistProblem("203.0.113.7\nexample.com\n10.0.0.0/33")).toBe(
      "example.com is not an IP address or an IPv4 range such as 10.0.0.0/8.",
    );
  });
});

describe("requiring SSO for a status page's private users", () => {
  test("is the status page's own column", () => {
    expect(STATUS_PAGE_REQUIRE_SSO_COLUMN).toBe("requireSsoForLogin");
    expect(
      new StatusPage().getTableColumnMetadata(STATUS_PAGE_REQUIRE_SSO_COLUMN),
    ).toBeTruthy();
  });

  test("named as the project's switch is, with the typo gone", () => {
    expect(StatusPageRequireSsoCopy.switchTitle).toBe("Require SSO for Login");
    expect(StatusPageRequireSsoCopy.cardTitle).toBe("SSO Settings");

    for (const sentence of Object.values(StatusPageRequireSsoCopy)) {
      expect(sentence).not.toMatch(/\byou you\b/);
      expect(sentence).not.toContain("locked out of the project");
    }
  });

  test("asks first, with a red button, before it turns signing in with a password off", () => {
    const confirmation: ModelSwitchConfirmation | undefined =
      getStatusPageRequireSsoConfirmation(true);

    expect(confirmation).toEqual({
      title: StatusPageRequireSsoCopy.confirmTitle,
      description: StatusPageRequireSsoCopy.confirmDescription,
      submitButtonText: StatusPageRequireSsoCopy.confirmButton,
      submitButtonType: ButtonStyleType.DANGER,
    });
    // It names who is locked out.
    expect(StatusPageRequireSsoCopy.confirmDescription).toContain(
      "Private users will no longer be able to sign in with an email and password.",
    );
  });

  test("turning it off locks nobody out, so it saves at once", () => {
    expect(getStatusPageRequireSsoConfirmation(false)).toBeUndefined();
  });
});
