import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import ScimSaveAccessNotice, {
  SCIM_SAVE_ACCESS_DESCRIPTION,
  SCIM_SAVE_ACCESS_NOTICE_TEST_ID,
  SCIM_SAVE_ACCESS_TITLE,
} from "../../../Dashboard/Identity/Components/ScimSaveAccessNotice";
import { canCurrentUserSaveScimConnections } from "../../../Dashboard/Identity/ScimSaveAccess";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import ObjectID from "Common/Types/ObjectID";
import Permission, { UserPermission } from "Common/Types/Permission";
import PermissionUtil from "Common/UI/Utils/Permission";
import UserUtil from "Common/UI/Utils/User";

/*
 * WHO SETTINGS > SCIM LETS ADD OR CHANGE A CONNECTION, AND WHAT IT TELLS
 * EVERYONE ELSE.
 *
 * Through its Groups endpoints a SCIM connection lets the identity provider
 * change the members of any team in the project, so the server saves one -
 * creating it, editing it or resetting its bearer token - only for someone
 * who could invite people to every team (Common/Server/Utils
 * /SsoProviderTeamGrant). Every project has its Owners team, so that is a
 * project owner with nothing blocking it, or a master admin
 * (Dashboard/Identity/ScimSaveAccess). Everyone else is told so
 * (ScimSaveAccessNotice), in every language the Dashboard ships.
 *
 * The signed-in user's permissions are read from where the Dashboard keeps
 * them, browser storage.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "61000000-0000-4000-8000-000000000001",
);
const LABEL_ID: ObjectID = new ObjectID("61000000-0000-4000-8000-000000000002");

function allow(
  permission: Permission,
  scope: PermissionScope = PermissionScope.All,
  labelIds: Array<ObjectID> = [],
): UserPermission {
  return {
    permission: permission,
    labelIds: labelIds,
    isBlockPermission: false,
    scope: scope,
    _type: "UserPermission",
  };
}

function block(permission: Permission): UserPermission {
  return {
    permission: permission,
    labelIds: [],
    isBlockPermission: true,
    _type: "UserPermission",
  };
}

function signIn(rows: Array<UserPermission>): void {
  PermissionUtil.setProjectPermissions({
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: rows,
  });
}

beforeEach(() => {
  window.localStorage.clear();
  UserUtil.setIsMasterAdmin(false);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("who may add or change a SCIM connection", () => {
  test.each([
    ["a project owner", [allow(Permission.ProjectOwner)], true],
    [
      "a project owner who is also an admin",
      [allow(Permission.ProjectOwner), allow(Permission.ProjectAdmin)],
      true,
    ],
    ["a project admin", [allow(Permission.ProjectAdmin)], false],
    [
      "a project admin who is also in Members",
      [allow(Permission.ProjectAdmin), allow(Permission.ProjectMember)],
      false,
    ],
    [
      "a custom role that may create and edit SCIM connections",
      [
        allow(Permission.CreateProjectSSO),
        allow(Permission.EditProjectSSO),
        allow(Permission.ReadProjectSSO),
      ],
      false,
    ],
    [
      "a project owner blocked from Project Owner",
      [allow(Permission.ProjectOwner), block(Permission.ProjectOwner)],
      false,
    ],
    [
      "a project owner only for what they own",
      [allow(Permission.ProjectOwner, PermissionScope.Owned)],
      false,
    ],
    [
      "a project owner only for one label",
      [allow(Permission.ProjectOwner, PermissionScope.Labels, [LABEL_ID])],
      false,
    ],
    ["someone with nothing in this project", [], false],
  ])(
    "%s: %s",
    (_name: string, rows: Array<UserPermission>, canSave: boolean) => {
      signIn(rows);

      expect(canCurrentUserSaveScimConnections()).toBe(canSave);
    },
  );

  test("before any permissions are stored, nobody", () => {
    expect(canCurrentUserSaveScimConnections()).toBe(false);
  });

  test("a master admin may, as on the server", () => {
    signIn([allow(Permission.ProjectAdmin)]);
    UserUtil.setIsMasterAdmin(true);

    expect(canCurrentUserSaveScimConnections()).toBe(true);
  });
});

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

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

type Locale = Record<string, unknown>;

function readLocale(locale: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Locale;
}

async function instanceFor(locale: string): Promise<i18n> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: locale,
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      [locale]: { translation: readLocale(locale) },
    },
    interpolation: { escapeValue: false },
  });

  return instance;
}

interface AlertText {
  title: string;
  description: string;
}

// Alert's bold title and the description under it.
function alertTextOf(alert: HTMLElement): AlertText {
  const lines: Array<Element> = Array.from(
    alert.querySelectorAll(".alert-message > div:first-child > div"),
  );

  return {
    title: lines[0]?.textContent || "",
    description: lines[1]?.textContent || "",
  };
}

describe("what Settings > SCIM tells everyone else", () => {
  test("who can, and why: Groups reach every team", () => {
    expect(SCIM_SAVE_ACCESS_TITLE).toBe(
      "Only a project owner can add or change SCIM connections.",
    );
    expect(SCIM_SAVE_ACCESS_DESCRIPTION).toContain("any team in this project");
    expect(SCIM_SAVE_ACCESS_DESCRIPTION).toContain(
      "seeing or resetting its bearer token",
    );
    expect(SCIM_SAVE_ACCESS_DESCRIPTION).toContain(
      "You can still see the connections and delete them.",
    );
  });

  test("both strings are entries in every locale, and en.json maps each to itself", () => {
    const english: Locale = readLocale("en");

    expect(english[SCIM_SAVE_ACCESS_TITLE]).toBe(SCIM_SAVE_ACCESS_TITLE);
    expect(english[SCIM_SAVE_ACCESS_DESCRIPTION]).toBe(
      SCIM_SAVE_ACCESS_DESCRIPTION,
    );

    for (const locale of OTHER_LOCALES) {
      const entries: Locale = readLocale(locale);

      expect({
        locale,
        title: typeof entries[SCIM_SAVE_ACCESS_TITLE],
        description: typeof entries[SCIM_SAVE_ACCESS_DESCRIPTION],
      }).toEqual({ locale, title: "string", description: "string" });
    }
  });

  test("English shows the component's own strings", async () => {
    render(
      <I18nextProvider i18n={await instanceFor("en")}>
        <ScimSaveAccessNotice />
      </I18nextProvider>,
    );

    expect(
      alertTextOf(screen.getByTestId(SCIM_SAVE_ACCESS_NOTICE_TEST_ID)),
    ).toEqual({
      title: SCIM_SAVE_ACCESS_TITLE,
      description: SCIM_SAVE_ACCESS_DESCRIPTION,
    });
  });

  test.each(OTHER_LOCALES)(
    "%s shows the notice in that language, SCIM keeping its name",
    async (locale: string) => {
      const entries: Locale = readLocale(locale);

      render(
        <I18nextProvider i18n={await instanceFor(locale)}>
          <ScimSaveAccessNotice />
        </I18nextProvider>,
      );

      const notice: AlertText = alertTextOf(
        screen.getByTestId(SCIM_SAVE_ACCESS_NOTICE_TEST_ID),
      );

      expect(notice).toEqual({
        title: entries[SCIM_SAVE_ACCESS_TITLE],
        description: entries[SCIM_SAVE_ACCESS_DESCRIPTION],
      });
      expect(notice.title).not.toBe(SCIM_SAVE_ACCESS_TITLE);
      expect(notice.description).not.toBe(SCIM_SAVE_ACCESS_DESCRIPTION);
      expect(notice.title).toContain("SCIM");
      expect(notice.description).toContain("SCIM");
    },
  );
});
