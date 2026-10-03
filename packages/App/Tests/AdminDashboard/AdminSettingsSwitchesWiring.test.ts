import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The admin dashboard's one-switch settings save the moment they are
 * flipped: Settings > Authentication's Sign Up, Require SSO for Login and
 * Project Creation, a user's Master Admin and a project's Customer Support
 * Access. Each was a card whose Edit dialog held the one switch; each is
 * the shared ModelSwitchCard now, saving through AdminModelAPI (the client
 * that sends no project headers), and the ones that can lock people out or
 * grant full access ask first.
 *
 * Their behaviour is rendered in Common/Tests/App/AdminDashboard
 * (AdminSettingsSwitches, AdminAuthenticationRequireSso,
 * AdminAuthenticationSsoCardLocales). This holds the wiring - which client,
 * which column, which way round - and the locale files: the admin
 * dashboard has no extraction tooling, so every key these pages ask for is
 * checked in all 17 languages here, and the keys the Edit dialogs used are
 * checked gone.
 */

const ADMIN_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "AdminDashboard",
  "src",
);

const LOCALES_DIR: string = path.join(ADMIN_SRC, "Locales");

const OTHER_LOCALES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

const ALL_LOCALES: Array<string> = ["en", ...OTHER_LOCALES];

type Locale = Record<string, unknown>;

// Comments dropped, whitespace collapsed.
function readCode(relative: string): string {
  return fs
    .readFileSync(path.join(ADMIN_SRC, relative), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\s+/g, " ");
}

function readLocale(locale: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Locale;
}

function nested(locale: Locale, key: string): unknown {
  let node: unknown = locale;

  for (const part of key.split(".")) {
    if (!node || typeof node !== "object") {
      return undefined;
    }

    node = (node as Record<string, unknown>)[part];
  }

  return node;
}

// Every t("pages.<block>.<key>") a source asks for, in source order.
function keysAskedFor(code: string, block: string): Array<string> {
  const pattern: RegExp = new RegExp(
    `\\bt\\(\\s*"(pages\\.${block.replace(/\./g, "\\.")}\\.[A-Za-z0-9_]+)"`,
    "g",
  );

  const keys: Array<string> = [];
  let match: RegExpExecArray | null = pattern.exec(code);

  while (match !== null) {
    if (!keys.includes(match[1] as string)) {
      keys.push(match[1] as string);
    }

    match = pattern.exec(code);
  }

  return keys;
}

const AUTHENTICATION: string = readCode(
  "Pages/Settings/Authentication/Index.tsx",
);
const USER_SETTINGS: string = readCode("Pages/Users/View/Settings.tsx");
const PROJECT_SUPPORT: string = readCode("Pages/Projects/View/Support.tsx");

describe("Settings > Authentication", () => {
  test("is three switch cards on the one GlobalConfig row, through the admin API, and no Edit dialog", () => {
    expect(
      AUTHENTICATION.split("<ModelSwitchCard<GlobalConfig>").length - 1,
    ).toBe(3);
    expect(AUTHENTICATION.split("modelAPI={AdminModelAPI}").length - 1).toBe(3);
    expect(AUTHENTICATION.split("modelId={globalConfigId}").length - 1).toBe(3);
    expect(AUTHENTICATION).toContain(
      "const globalConfigId: ObjectID = ObjectID.getZeroObjectID();",
    );
    expect(AUTHENTICATION).not.toContain("CardModelDetail");
    expect(AUTHENTICATION).not.toContain("editButtonText");
  });

  test("sign up and project creation read on = people can, over the disable columns", () => {
    expect(AUTHENTICATION).toContain(
      'column="disableSignup" isInverted={true}',
    );
    expect(AUTHENTICATION).toContain(
      'column="disableUserProjectCreation" isInverted={true}',
    );
    expect(AUTHENTICATION).toMatch(
      /column="requireSsoForLogin" (?!isInverted)/,
    );
  });

  test("in the order sign up, SSO, project creation", () => {
    const signUp: number = AUTHENTICATION.indexOf('column="disableSignup"');
    const sso: number = AUTHENTICATION.indexOf('column="requireSsoForLogin"');
    const projects: number = AUTHENTICATION.indexOf(
      'column="disableUserProjectCreation"',
    );

    expect(signUp).toBeGreaterThan(-1);
    expect(signUp).toBeLessThan(sso);
    expect(sso).toBeLessThan(projects);
  });

  test("only requiring SSO asks, as a danger, and only before it turns on", () => {
    expect(AUTHENTICATION.split("getConfirmation=").length - 1).toBe(1);
    expect(AUTHENTICATION).toContain(
      "getConfirmation={getRequireSsoConfirmation}",
    );
    expect(AUTHENTICATION).toContain("if (!isTurningOn) { return undefined; }");
    expect(AUTHENTICATION).toContain(
      "submitButtonType: ButtonStyleType.DANGER",
    );
  });
});

describe("a user's Settings: Master Admin", () => {
  test("is a switch card on isMasterAdmin, through the admin API, and no Edit dialog", () => {
    expect(USER_SETTINGS).toContain("<ModelSwitchCard<User>");
    expect(USER_SETTINGS).toContain('column="isMasterAdmin"');
    expect(USER_SETTINGS.split("modelAPI={AdminModelAPI}").length - 1).toBe(2);
    expect(USER_SETTINGS).not.toContain("CardModelDetail");
    expect(USER_SETTINGS).not.toContain("masterAdminEditButton");
  });

  test("asks both ways, and knows when the account is the signed-in admin's own", () => {
    expect(USER_SETTINGS).toContain(
      "const isOwnAccount: boolean = UserUtil.getUserId().toString() === modelId.toString();",
    );
    expect(USER_SETTINGS).toContain(
      "getConfirmation={(isTurningOn: boolean): ModelSwitchConfirmation => { return getMasterAdminConfirmation({ isTurningOn: isTurningOn, isOwnAccount: isOwnAccount,",
    );
    // Only removing your own access is a danger.
    expect(USER_SETTINGS.split("ButtonStyleType.DANGER").length - 1).toBe(1);
    expect(USER_SETTINGS).toMatch(
      /if \(data\.isOwnAccount\) \{ return \{[^}]*submitButtonType: ButtonStyleType\.DANGER/,
    );
  });
});

describe("a project's Support", () => {
  test("has no banner of its own: the consent warning is the switch's dialog", () => {
    expect(PROJECT_SUPPORT).not.toContain("AlertType.WARNING");
    expect(PROJECT_SUPPORT).toContain(
      'description: t("pages.projectSupport.consentWarning")',
    );
  });
});

describe("the locale keys these pages ask for", () => {
  const asked: Array<string> = [
    ...keysAskedFor(AUTHENTICATION, "settings.authentication"),
    ...keysAskedFor(USER_SETTINGS, "userView"),
    ...keysAskedFor(PROJECT_SUPPORT, "projectSupport"),
  ];

  // The keys this change added, which every language translates.
  const added: Array<string> = [
    "pages.settings.authentication.signUpCardTitle",
    "pages.settings.authentication.signUpCardDescription",
    "pages.settings.authentication.signUpSwitchTitle",
    "pages.settings.authentication.signUpSwitchOnDescription",
    "pages.settings.authentication.signUpSwitchOffDescription",
    "pages.settings.authentication.projectCreationSwitchTitle",
    "pages.settings.authentication.projectCreationSwitchOnDescription",
    "pages.settings.authentication.projectCreationSwitchOffDescription",
    "pages.userView.masterAdminSwitchTitle",
    "pages.userView.masterAdminSwitchOnDescription",
    "pages.userView.masterAdminSwitchOffDescription",
    "pages.userView.masterAdminGrantConfirmTitle",
    "pages.userView.masterAdminGrantConfirmDescription",
    "pages.userView.masterAdminGrantConfirmButton",
    "pages.userView.masterAdminRevokeConfirmTitle",
    "pages.userView.masterAdminRevokeConfirmDescription",
    "pages.userView.masterAdminRevokeConfirmButton",
    "pages.userView.masterAdminRevokeOwnConfirmTitle",
    "pages.userView.masterAdminRevokeOwnConfirmDescription",
    "pages.userView.masterAdminRevokeOwnConfirmButton",
    "pages.projectSupport.allowConfirmTitle",
    "pages.projectSupport.allowConfirmButton",
  ];

  test("are really read from the pages", () => {
    // A typo'd pattern above would otherwise check nothing.
    expect(asked.length).toBeGreaterThan(25);

    for (const key of added) {
      expect({ key, asked: asked.includes(key) }).toEqual({
        key,
        asked: true,
      });
    }
  });

  test.each(ALL_LOCALES)(
    "%s has every one, with no placeholder",
    (locale: string) => {
      const entries: Locale = readLocale(locale);

      for (const key of asked) {
        const value: unknown = nested(entries, key);

        expect({ key, type: typeof value }).toEqual({ key, type: "string" });
        expect({ key, empty: (value as string).trim() === "" }).toEqual({
          key,
          empty: false,
        });
        expect({ key, placeholder: (value as string).includes("{{") }).toEqual({
          key,
          placeholder: false,
        });
      }
    },
  );

  test.each(OTHER_LOCALES)("%s translates the added ones", (locale: string) => {
    const english: Locale = readLocale("en");
    const entries: Locale = readLocale(locale);

    for (const key of added) {
      expect({
        key,
        translated: nested(entries, key) !== nested(english, key),
      }).toEqual({ key, translated: true });
    }
  });

  test("every language keeps the blocks' keys in English's order", () => {
    const english: Locale = readLocale("en");

    for (const block of [
      "pages.settings.authentication",
      "pages.userView",
      "pages.projectSupport",
    ]) {
      const order: Array<string> = Object.keys(
        nested(english, block) as Record<string, unknown>,
      );

      for (const locale of OTHER_LOCALES) {
        expect({
          locale,
          block,
          order: Object.keys(
            nested(readLocale(locale), block) as Record<string, unknown>,
          ),
        }).toEqual({ locale, block, order });
      }
    }
  });

  test("the support switch is named as the customer's own is", () => {
    expect(nested(readLocale("en"), "pages.projectSupport.fieldLabel")).toBe(
      "Let OneUptime support access this project",
    );
  });
});

describe("what the Edit dialogs used is gone", () => {
  const retiredNested: Array<string> = [
    "pages.settings.authentication.authCardTitle",
    "pages.settings.authentication.authCardDescription",
    "pages.settings.authentication.authEditButton",
    "pages.settings.authentication.projectCreationEditButton",
    "pages.userView.masterAdminEditButton",
    "pages.projectSupport.editButton",
  ];

  const retiredFlat: Array<string> = [
    "Should we disable sign up of new users to OneUptime?",
    "Restrict Project Creation to Admins Only",
    "When enabled, only master admin users can create new projects.",
    "Enable to give this user full access to the entire platform.",
    "Master Admin",
  ];

  test.each(ALL_LOCALES)("%s has none of their keys", (locale: string) => {
    const entries: Locale = readLocale(locale);

    expect(
      retiredNested.filter((key: string): boolean => {
        return nested(entries, key) !== undefined;
      }),
    ).toEqual([]);
    expect(
      retiredFlat.filter((key: string): boolean => {
        return key in entries;
      }),
    ).toEqual([]);
  });

  test("and no page asks for them", () => {
    for (const code of [AUTHENTICATION, USER_SETTINGS, PROJECT_SUPPORT]) {
      for (const key of retiredNested) {
        expect(code).not.toContain(key);
      }

      for (const text of retiredFlat) {
        expect(code).not.toContain(`"${text}"`);
      }
    }
  });
});

describe("the switch's own words", () => {
  // ModelSwitchRow says these after a flip; the admin dashboard had neither.
  const words: Array<string> = ["Saving…", "Saved"];

  test("English has them as themselves", () => {
    const english: Locale = readLocale("en");

    for (const word of words) {
      expect(english[word]).toBe(word);
    }
  });

  test.each(OTHER_LOCALES)("%s translates them", (locale: string) => {
    const entries: Locale = readLocale(locale);

    for (const word of words) {
      expect({ word, type: typeof entries[word] }).toEqual({
        word,
        type: "string",
      });
      expect({ word, translated: entries[word] !== word }).toEqual({
        word,
        translated: true,
      });
    }
  });
});
