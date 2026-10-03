import {
  IncidentRoleSettingsCopy,
  canOfferAllowMultipleUsers,
  getIncidentRoleDeleteLockedReason,
  getIncidentRoleSettingsStrings,
  getPrimaryIncidentRoleIds,
} from "../../FeatureSet/Dashboard/src/Components/IncidentRole/IncidentRoleSettings";
import IncidentRole from "Common/Models/DatabaseModels/IncidentRole";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ObjectID from "Common/Types/ObjectID";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Incidents → Settings → Incident Roles.
 *
 * The maintainer: "To make things simple, can we remove all the roles except
 * Incident Commander by default? People can add more roles if they feel
 * like. Please also remove multiple users column from modal table (as this
 * complicates the UI). We need to make the UI as easy to understand as
 * possible."
 *
 * Pinned here, without React (an App test must not import a .tsx):
 *   - the page's words, each with an entry in all seventeen Dashboard locale
 *     files, and the old page's words gone from them;
 *   - the two rules the page shows about Incident Commander: its Delete is
 *     locked, and its form leaves out Allow Multiple Users;
 *   - what the page's source wires up (it is rendered for real in Common's
 *     Tests/App/Dashboard/IncidentRolesSettingsPage.test.tsx);
 *   - the docs, in English and Persian, saying what a new project starts
 *     with.
 */

const DASHBOARD_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const LOCALES_DIR: string = path.join(DASHBOARD_DIR, "Locales");

const PAGE_SOURCE: string = fs.readFileSync(
  path.join(
    DASHBOARD_DIR,
    "Pages",
    "Incidents",
    "Settings",
    "IncidentRoles.tsx",
  ),
  "utf8",
);

const DOCS_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Docs",
  "Content",
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

/*
 * Entries other pages share - column titles, step titles - some of them the
 * same word in some languages.
 */
const SHARED_WITH_OTHER_FEATURES: Array<string> = [
  "Name",
  "Description",
  "Basic Info",
  "Appearance",
  "Incident Roles",
];

// Roles a new project used to start with, and no longer does.
const RETIRED_DEFAULT_ROLES: Array<string> = [
  "Responder",
  "Communications Lead",
  "Observer",
];

const STRINGS: Array<string> = getIncidentRoleSettingsStrings();

const PLACEHOLDER: RegExp = /\{\{[^}]+\}\}/g;

function placeholders(text: string): Array<string> {
  return (text.match(PLACEHOLDER) || []).sort();
}

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

function role(data: {
  id?: string | undefined;
  isPrimaryRole?: boolean | undefined;
  isDeleteable?: boolean | undefined;
}): IncidentRole {
  const item: IncidentRole = new IncidentRole();

  if (data.id) {
    item._id = data.id;
  }

  if (data.isPrimaryRole !== undefined) {
    item.isPrimaryRole = data.isPrimaryRole;
  }

  if (data.isDeleteable !== undefined) {
    item.isDeleteable = data.isDeleteable;
  }

  return item;
}

// The "## Incident roles" section of a docs page, up to the next heading.
function docsSection(file: string, heading: string): string {
  const markdown: string = fs.readFileSync(path.join(DOCS_DIR, file), "utf8");
  const start: number = markdown.indexOf(`${heading}\n`);

  expect({ file, heading, found: start >= 0 }).toEqual({
    file,
    heading,
    found: true,
  });

  const rest: string = markdown.slice(start + heading.length);
  const next: number = rest.search(/\n## /);

  return next >= 0 ? rest.slice(0, next) : rest;
}

describe("the Incident Roles page's words", () => {
  test("cover the card, the locked Delete and the form", () => {
    expect(STRINGS).toContain(IncidentRoleSettingsCopy.title);
    expect(STRINGS).toContain(IncidentRoleSettingsCopy.description);
    expect(STRINGS).toContain(IncidentRoleSettingsCopy.deleteLockedReason);
    expect(STRINGS).toContain(IncidentRoleSettingsCopy.allowMultipleUsersTitle);
    expect(STRINGS).toContain(
      IncidentRoleSettingsCopy.allowMultipleUsersDescription,
    );
    expect(STRINGS).toContain(IncidentRoleSettingsCopy.descriptionPlaceholder);
  });

  test("leave out the name placeholder, a role name kept as it is", () => {
    expect(STRINGS).not.toContain(IncidentRoleSettingsCopy.namePlaceholder);
  });

  test("the card invites more roles, and names only the one every project has", () => {
    expect(IncidentRoleSettingsCopy.description).toContain(
      "Incident Commander",
    );
    expect(IncidentRoleSettingsCopy.description).toContain("Add more");

    for (const retired of RETIRED_DEFAULT_ROLES) {
      expect(IncidentRoleSettingsCopy.description).not.toContain(retired);
    }
  });

  test("the form suggests a role to add, not Incident Commander", () => {
    // Every project has Incident Commander, and a name is unique per project.
    expect(IncidentRoleSettingsCopy.namePlaceholder).not.toBe(
      "Incident Commander",
    );
    expect(IncidentRoleSettingsCopy.namePlaceholder.length).toBeGreaterThan(1);
    expect(IncidentRoleSettingsCopy.descriptionPlaceholder).not.toMatch(
      /primary decision maker/i,
    );
  });

  test("the locked Delete says why, the way the state pages do", () => {
    expect(IncidentRoleSettingsCopy.deleteLockedReason).toMatch(
      /can be renamed, but not deleted\.$/,
    );
  });

  test.each(STRINGS)("en.json maps %j to itself", (text: string) => {
    expect(readLocale("en")[text]).toBe(text);
  });

  describe.each(OTHER_LOCALES)("%s", (locale: string) => {
    const translations: Record<string, unknown> = readLocale(locale);

    test.each(STRINGS)("translates %j", (text: string) => {
      const value: unknown = translations[text];

      expect(typeof value).toBe("string");
      expect((value as string).trim().length).toBeGreaterThan(0);
      expect(placeholders(value as string)).toEqual(placeholders(text));

      if (!SHARED_WITH_OTHER_FEATURES.includes(text)) {
        expect(value).not.toBe(text);
      }
    });

    test("keeps the role name Incident Commander as the table shows it", () => {
      expect(translations[IncidentRoleSettingsCopy.description]).toContain(
        "Incident Commander",
      );
    });
  });
});

describe("the old page's words", () => {
  const RETIRED: Array<string> = [
    "Multiple Users",
    "Define roles that can be assigned to users during incident response (e.g., Incident Commander, Responder).",
    "Primary decision maker during an incident.",
  ];

  test.each(["en", ...OTHER_LOCALES])("are gone from %s", (locale: string) => {
    const translations: Record<string, unknown> = readLocale(locale);

    for (const text of RETIRED) {
      expect(translations[text]).toBeUndefined();
    }
  });

  test("are not on the page any more", () => {
    for (const text of RETIRED) {
      expect(PAGE_SOURCE).not.toContain(`"${text}"`);
    }
  });
});

describe("Incident Commander's Delete", () => {
  test("is locked, with the reason, for the role that cannot be deleted", () => {
    expect(
      getIncidentRoleDeleteLockedReason(role({ isDeleteable: false })),
    ).toBe(IncidentRoleSettingsCopy.deleteLockedReason);
  });

  test("is open for a role the project added", () => {
    expect(
      getIncidentRoleDeleteLockedReason(role({ isDeleteable: true })),
    ).toBeUndefined();
  });

  test("is open when the flag was not read, rather than guessed locked", () => {
    expect(getIncidentRoleDeleteLockedReason(role({}))).toBeUndefined();
  });

  test("follows the flag, not the name: a renamed commander stays locked", () => {
    const renamed: IncidentRole = role({ isDeleteable: false });
    renamed.name = "Incident Lead";

    expect(getIncidentRoleDeleteLockedReason(renamed)).toBe(
      IncidentRoleSettingsCopy.deleteLockedReason,
    );

    const lookalike: IncidentRole = role({ isDeleteable: true });
    lookalike.name = "Incident Commander";

    expect(getIncidentRoleDeleteLockedReason(lookalike)).toBeUndefined();
  });
});

describe("the primary roles among the listed ones", () => {
  const COMMANDER_ID: string = ObjectID.generate().toString();
  const RESPONDER_ID: string = ObjectID.generate().toString();

  test("are the ones flagged primary", () => {
    expect(
      Array.from(
        getPrimaryIncidentRoleIds([
          role({ id: COMMANDER_ID, isPrimaryRole: true }),
          role({ id: RESPONDER_ID, isPrimaryRole: false }),
        ]),
      ),
    ).toEqual([COMMANDER_ID]);
  });

  test("leave out a role whose flag was not read, and one with no id", () => {
    expect(
      getPrimaryIncidentRoleIds([
        role({ id: RESPONDER_ID }),
        role({ isPrimaryRole: true }),
      ]).size,
    ).toBe(0);
  });

  test("are none for an empty list", () => {
    expect(getPrimaryIncidentRoleIds([]).size).toBe(0);
  });
});

describe("Allow Multiple Users in the form", () => {
  const COMMANDER_ID: string = ObjectID.generate().toString();
  const RESPONDER_ID: string = ObjectID.generate().toString();
  const PRIMARY: ReadonlySet<string> = new Set<string>([COMMANDER_ID]);

  function offered(values: Record<string, unknown>): boolean {
    return canOfferAllowMultipleUsers({
      values: values as FormValues<IncidentRole>,
      primaryRoleIds: PRIMARY,
    });
  }

  test("is offered when a role is created", () => {
    expect(offered({})).toBe(true);
    expect(offered({ name: "Scribe" })).toBe(true);
    expect(offered({ _id: "" })).toBe(true);
  });

  test("is offered when a role the project added is edited", () => {
    expect(offered({ _id: RESPONDER_ID })).toBe(true);
  });

  test("is left out when Incident Commander is edited", () => {
    expect(offered({ _id: COMMANDER_ID })).toBe(false);
  });

  test("is left out for the commander whatever form its id takes", () => {
    expect(offered({ _id: new ObjectID(COMMANDER_ID) })).toBe(false);
  });

  test("is offered while the list has not loaded", () => {
    expect(
      canOfferAllowMultipleUsers({
        values: { _id: COMMANDER_ID } as FormValues<IncidentRole>,
        primaryRoleIds: new Set<string>(),
      }),
    ).toBe(true);
  });
});

describe("the page's wiring", () => {
  test("its table has no Multiple Users column, and does not read the flag", () => {
    expect(PAGE_SOURCE).not.toMatch(/title:\s*"Multiple Users"/);

    const columnsStart: number = PAGE_SOURCE.indexOf("columns={[");

    expect(columnsStart).toBeGreaterThan(-1);
    expect(PAGE_SOURCE.slice(columnsStart)).not.toContain(
      "canAssignMultipleUsers",
    );

    const selectStart: number = PAGE_SOURCE.indexOf("selectMoreFields={{");
    const select: string = PAGE_SOURCE.slice(
      selectStart,
      PAGE_SOURCE.indexOf("}}", selectStart),
    );

    expect(select).not.toContain("canAssignMultipleUsers");
    expect(select).toContain("isDeleteable: true");
    expect(select).toContain("isPrimaryRole: true");
  });

  test("Allow Multiple Users is folded under the shared Advanced section", () => {
    expect(PAGE_SOURCE).toContain("getAdvancedFormSection<IncidentRole>()");

    const field: string = PAGE_SOURCE.slice(
      PAGE_SOURCE.indexOf("canAssignMultipleUsers: true,"),
      PAGE_SOURCE.indexOf("roleIcon: true,"),
    );

    expect(field).toContain("collapsibleSection: advancedSection");
    expect(field).toContain("canOfferAllowMultipleUsers(");
    expect(field).toContain('stepId: "basic-info"');
  });

  test("locks Delete through the table's per-row lock", () => {
    expect(PAGE_SOURCE).toContain("getDeleteDisabledReason=");
    expect(PAGE_SOURCE).toContain("getIncidentRoleDeleteLockedReason(role)");
  });

  test("never adds a wizard step named Advanced", () => {
    expect(PAGE_SOURCE).not.toMatch(/title:\s*"Advanced"/);
  });
});

describe("the docs", () => {
  test("say a new project starts with Incident Commander alone, in English", () => {
    const section: string = docsSection(
      "en/incidents/settings.md",
      "## Incident roles",
    );

    expect(section).toContain(
      "A new project starts with one role, **Incident Commander**",
    );
    expect(section).toContain("can be renamed, but not deleted");
    expect(section).toContain("**Allow Multiple Users**");
    expect(section).toContain("**Advanced**");
    expect(section).toContain("**Create Incident Role**");
    expect(section).not.toContain(
      "the card description gives Incident Commander and Responder as examples",
    );
  });

  test("say projects from earlier versions keep the roles they started with", () => {
    const section: string = docsSection(
      "en/incidents/settings.md",
      "## Incident roles",
    );

    for (const retired of RETIRED_DEFAULT_ROLES) {
      expect(section).toContain(retired);
    }

    expect(section).toContain("earlier versions of OneUptime");
  });

  test("say the same in Persian, the incident pages' translated corpus", () => {
    const section: string = docsSection(
      "fa/incidents/settings.md",
      "## نقش‌های حادثه",
    );

    expect(section).toContain("**Incident Commander**");
    expect(section).toContain("**Allow Multiple Users**");
    expect(section).toContain("**Advanced**");
    expect(section).toContain("**Create Incident Role**");
    expect(section).not.toContain(
      "توضیحات کارت فرمانده حادثه و پاسخ‌دهنده را به‌عنوان نمونه می‌آورد",
    );
  });

  test("the declare docs no longer list Responder as a role every project has", () => {
    const english: string = fs.readFileSync(
      path.join(DOCS_DIR, "en/incidents/declaring-incidents.md"),
      "utf8",
    );

    expect(english).not.toContain(
      "Incident Commander, Responder, and whatever else your process needs",
    );
    expect(english).toContain("A new project has one, Incident Commander");

    const persian: string = fs.readFileSync(
      path.join(DOCS_DIR, "fa/incidents/declaring-incidents.md"),
      "utf8",
    );

    expect(persian).not.toContain("فرمانده حادثه، پاسخ‌دهنده، و هر چیز دیگری");
    expect(persian).toContain("پروژه تازه یک نقش دارد، Incident Commander");
  });
});
