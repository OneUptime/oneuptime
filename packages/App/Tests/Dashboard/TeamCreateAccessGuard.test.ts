import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A NEW TEAM STARTS WITH THE ACCESS YOU PICK; BLOCK PERMISSIONS FOLD UNDER
 * ADVANCED - as for API keys.
 *
 * Create Team asked for a name and a description and made a team with no
 * permissions, and a team's Block Permissions had a page and a menu entry of
 * their own. This holds the shape that replaced them, so a page written
 * later cannot quietly bring the old one back:
 *
 *   - Create Team and Create API Key ask the one Access question
 *     (Components/Permission/RoleAccess) and add the role through it, with
 *     the one notice for a refusal; nothing else in the Dashboard writes the
 *     Access cards or a role list of its own;
 *   - a team's Permissions page holds its block permissions in an Advanced
 *     section, and the menu, the route table and the breadcrumbs have no
 *     Block Permissions page - its old URL forwards to Permissions;
 *   - Settings > Users leaves its empty state to the table;
 *   - every new sentence is translated in all sixteen other languages.
 *
 * Source is read as text: App's tests never import a React module.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

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

// Without its comments, collapsed to one line.
function readSource(file: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\s+/g, " ");
}

const SOURCE_FILE: RegExp = /\.tsx?$/;

// Every .ts/.tsx file under the Dashboard's src, relative to it.
function listSources(directory: string = DASHBOARD_SRC): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "Locales") {
        continue;
      }

      found.push(...listSources(full));
    } else if (SOURCE_FILE.test(entry.name)) {
      found.push(path.relative(DASHBOARD_SRC, full));
    }
  }

  return found;
}

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const NEW_SENTENCES: Array<string> = [
  "Block permissions: what this team can never do, even when one of its roles or permissions allows it.",
  "Blocks win over this team's roles and permissions. A block with labels applies only to resources that carry one of them.",
  "No access yet. Add a narrower role, such as Incident Member, or single permissions on the team's page.",
  "Nothing is blocked for this team.",
  "Open the team to give it a role",
  "This team can do nothing yet. Add a role to give it access.",
  "What the team's members can do. You can change it on the team's page at any time.",
  "What this team's members can do. Add a role for a ready-made set of permissions, or a single permission for exactly what you need.",
  "{{teamName}} was created without access.",
];

describe("Create Team asks the Access question Create API Key asks", () => {
  test("the Teams page builds its form, its cards and the role from the shared helper", () => {
    const page: string = readSource("Pages/Teams/Index.tsx");

    expect(page).toContain(
      "getRoleAccessOptionsForCurrentUser(RoleAccessHolder.Team)",
    );
    expect(page).toContain("getTeamCreateFormFields({");
    expect(page).toContain("formFields={createFormFields}");
    expect(page).toContain(
      "getRoleAccessRole( formValues[ROLE_ACCESS_FIELD_KEY], )",
    );
    expect(page).toContain("giveRoleAccess({ holder: RoleAccessHolder.Team,");
    expect(page).toContain("<RoleAccessNotice holder={RoleAccessHolder.Team}");
    // Where a new team opens is decided in one place (TeamCreateForm).
    expect(page).toContain("getNewTeamPage({");

    // No fields written out on the page any more.
    expect(page).not.toContain("FormFieldSchemaType.");
  });

  test("the API Keys page uses the same helper and notice", () => {
    const page: string = readSource("Pages/Settings/APIKeys.tsx");

    expect(page).toContain(
      "getRoleAccessOptionsForCurrentUser( RoleAccessHolder.ApiKey, )",
    );
    expect(page).toContain("giveRoleAccess({ holder: RoleAccessHolder.ApiKey,");
    expect(page).toContain(
      "<RoleAccessNotice holder={RoleAccessHolder.ApiKey}",
    );
    expect(page).not.toContain("<Alert");
  });

  test.each([
    ["Create Team", "Components/Team/TeamCreateForm.ts", "Team"],
    ["Create API Key", "Components/ApiKey/ApiKeyCreateForm.ts", "ApiKey"],
  ])(
    "%s asks Access with the shared field",
    (_name: string, file: string, holder: string) => {
      const form: string = readSource(file);

      expect(form).toContain(
        `getRoleAccessFormField<${holder}>({ holder: RoleAccessHolder.${holder},`,
      );
      // Not one written out by hand.
      expect(form).not.toContain("FormFieldSchemaType.CardSelect");
      expect(form).not.toContain('title: "Access"');
    },
  );

  test("the Access cards are written in one place, and the key's own copy is gone", () => {
    expect(
      fs.existsSync(
        path.join(DASHBOARD_SRC, "Components/ApiKey/ApiKeyAccess.ts"),
      ),
    ).toBe(false);

    const writingTheCards: Array<string> = listSources().filter(
      (file: string): boolean => {
        return readSource(file).includes('title: "Choose permissions later"');
      },
    );

    expect(writingTheCards).toEqual([
      path.join("Components", "Permission", "RoleAccess.ts"),
    ]);

    const importingTheOldHelper: Array<string> = listSources().filter(
      (file: string): boolean => {
        return readSource(file).includes("ApiKey/ApiKeyAccess");
      },
    );

    expect(importingTheOldHelper).toEqual([]);
  });

  test("Choose permissions later is picked to start with, as the server stores no access", () => {
    const helper: string = readSource("Components/Permission/RoleAccess.ts");

    expect(helper).toContain("defaultValue: ROLE_ACCESS_LATER,");
    expect(helper).toContain(
      'export const ROLE_ACCESS_LATER: string = "ChoosePermissionsLater";',
    );
  });

  test("a team's role is added at scope All, through the team permission endpoint", () => {
    const helper: string = readSource("Components/Permission/RoleAccess.ts");

    expect(helper).toContain("permission.scope = PermissionScope.All;");
    expect(helper).toContain("modelType: TeamPermission,");
    expect(helper).toContain("permission.isBlockPermission = false;");
  });

  test("the cards follow the server: grant ceiling, the right to add permissions, and table-wide blocks", () => {
    const helper: string = readSource("Components/Permission/RoleAccess.ts");

    expect(helper).toContain("GrantablePermission.canCurrentUserGrant(");
    expect(helper).toContain(
      "PermissionGate.check(permissionModel, ModelAction.Create).isAllowed",
    );
    expect(helper).toContain(
      "!GrantablePermission.isCurrentUserBlockedFromAny( permissionModel.getCreatePermissions(), )",
    );
  });
});

describe("a team's block permissions fold under Advanced on its Permissions page", () => {
  test("the Permissions page holds the allow table, then Advanced with the block table", () => {
    const page: string = readSource("Pages/Teams/View/Permissions.tsx");

    const allow: number = page.indexOf(
      "permissionType={PermissionType.AllowPermissions}",
    );
    const advanced: number = page.indexOf("<AdvancedPageSection");
    const block: number = page.indexOf(
      "permissionType={PermissionType.BlockPermissions}",
    );
    const advancedEnd: number = page.indexOf("</AdvancedPageSection>");

    expect(allow).toBeGreaterThan(-1);
    expect(advanced).toBeGreaterThan(allow);
    expect(block).toBeGreaterThan(advanced);
    expect(advancedEnd).toBeGreaterThan(block);

    // Block Permissions is a chip, with how many, while the team has any.
    expect(page).toContain("isSet: blockPermissionCount > 0");
    expect(page).toContain(
      "onPermissionCountChange={(count: number) => { setBlockPermissionCount(count); }}",
    );
  });

  test("the permission table reports how many rows it holds", () => {
    const table: string = readSource("Components/Team/TeamPermissionTable.tsx");

    expect(table).toContain(
      "onFetchSuccess={(_data: Array<TeamPermission>, totalCount: number) => { props.onPermissionCountChange?.(totalCount); }}",
    );
  });

  test("no menu, route, breadcrumb or link points at a Block Permissions page", () => {
    const offenders: Array<string> = listSources().filter(
      (file: string): boolean => {
        const source: string = readSource(file);

        return (
          source.includes("TEAM_VIEW_BLOCK_PERMISSIONS") ||
          source.includes("Pages/Teams/View/BlockPermissions")
        );
      },
    );

    expect(offenders).toEqual([]);

    expect(
      fs.existsSync(
        path.join(DASHBOARD_SRC, "Pages/Teams/View/BlockPermissions.tsx"),
      ),
    ).toBe(false);
    expect(readSource("Pages/Teams/View/SideMenu.tsx")).not.toContain(
      "Block Permissions",
    );
    expect(readSource("Utils/Breadcrumbs/TeamsBreadcrumbs.ts")).not.toContain(
      "Block Permissions",
    );
    expect(readSource("Utils/RouteMap.ts")).not.toContain(
      "/block-permissions`",
    );
  });

  test("the old address forwards to Permissions", () => {
    const routes: string = readSource("Routes/TeamsRoutes.tsx");

    expect(routes).toContain(
      'export const MOVED_TEAM_BLOCK_PERMISSIONS_PATH: string = "block-permissions";',
    );
    expect(routes).toContain(
      "<PageRoute path={MOVED_TEAM_BLOCK_PERMISSIONS_PATH} element={ <MovedPageRedirect pageMap={PageMap.TEAM_VIEW_PERMISSIONS} /> } />",
    );
  });

  test("the role pickers stay plain grids", () => {
    const table: string = readSource("Components/Team/TeamPermissionTable.tsx");

    expect(table).toContain("getRoleCardSelectOptions()");
    expect(table).not.toContain("cardSelectSearchable");
    expect(table).not.toContain("cardSelectCollapsibleGroups");
  });
});

describe("Settings > Users", () => {
  test("leaves its empty state to the table", () => {
    const page: string = readSource("Pages/Users/Index.tsx");

    expect(page).not.toContain("noItemsMessage=");
    expect(page).not.toContain("Please try again in sometime");
  });
});

describe("the new sentences", () => {
  const english: Record<string, unknown> = readLocale("en");

  test("are in en.json", () => {
    for (const sentence of NEW_SENTENCES) {
      expect([sentence, english[sentence]]).toEqual([sentence, sentence]);
    }
  });

  test.each(OTHER_LOCALES)("are translated in %s", (locale: string) => {
    const translations: Record<string, unknown> = readLocale(locale);

    for (const sentence of NEW_SENTENCES) {
      const translated: unknown = translations[sentence];

      expect([sentence, typeof translated]).toEqual([sentence, "string"]);
      expect([sentence, translated === sentence]).toEqual([sentence, false]);

      if (sentence.includes("{{teamName}}")) {
        expect(translated as string).toContain("{{teamName}}");
      }
    }
  });

  test("the sentences no page reads any more are gone from every locale", () => {
    for (const locale of ["en", ...OTHER_LOCALES]) {
      const translations: Record<string, unknown> = readLocale(locale);

      expect([
        locale,
        translations["No permissions created for this team so far."],
      ]).toEqual([locale, undefined]);
      expect([
        locale,
        translations[
          "Please wait, we are refreshing the list of users for this project. Please try again in sometime."
        ],
      ]).toEqual([locale, undefined]);
    }
  });
});
