import ApiKeyCustomRole from "Common/Models/DatabaseModels/ApiKeyCustomRole";
import ApiKeyPermission from "Common/Models/DatabaseModels/ApiKeyPermission";
import CustomRole from "Common/Models/DatabaseModels/CustomRole";
import CustomRolePermission from "Common/Models/DatabaseModels/CustomRolePermission";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Entities from "Common/Models/DatabaseModels/Index";
import TeamCustomRole from "Common/Models/DatabaseModels/TeamCustomRole";
import TeamPermission from "Common/Models/DatabaseModels/TeamPermission";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "Common/Types/Permission";
import {
  isPermissionAllowedInCustomRole,
  PERMISSIONS_NEVER_IN_A_CUSTOM_ROLE,
} from "Common/Types/Team/CustomRole";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { drawnActionLabel, drawnDashboardLabel } from "./DocsDashboardLabels";
import {
  menuSections,
  MenuSection,
  sectionByTitle,
} from "./DocsDashboardMenus";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * CUSTOM ROLES ON USERS, TEAMS & PERMISSIONS: what the docs say about them
 * is what the product does.
 *
 * The section (Permissions > Custom roles) walks through making a role and
 * giving it to teams and API keys, then says how a role behaves. Each claim
 * is held here to the code that makes it true, so a change to the product
 * that would leave the docs behind fails here:
 *
 *   - the example role is one the Create Custom Role form can make: built-in
 *     roles a custom role may hold;
 *   - a role never holds Project Owner (PERMISSIONS_NEVER_IN_A_CUSTOM_ROLE);
 *   - custom roles take the plan changing a team's permissions takes;
 *   - API keys take custom roles, as teams do - a key holds copies of a
 *     role's permissions, but of none limited to what someone owns;
 *   - every button and page the steps name is drawn by the Dashboard with
 *     that English label;
 *   - the steps find Roles where the Teams menu draws it: in its Settings
 *     section, which starts folded, so the first step says to expand it.
 *
 * Every docs language has the section, on the line the English page has it
 * (PermissionsAndSelfHostedDocsTranslations holds the rest of each
 * translation, label by label).
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");
const DASHBOARD_SRC: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src",
);
const PAGE: string = "permissions/index.md";

const EXAMPLE_ROLES: Array<Permission> = [
  Permission.IncidentMember,
  Permission.AlertMember,
  Permission.OnCallViewer,
];

function readPage(language: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, PAGE), "utf8");
}

function readSource(file: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, file), "utf8");
}

// The English section, from its heading to the next heading of its level.
function englishSection(): string {
  const page: string = readPage("en");
  const start: number = page.indexOf("\n### Custom roles\n");

  expect(start).toBeGreaterThan(0);

  const end: number = page.indexOf("\n### ", start + 1);

  return page.slice(start, end);
}

// The line (0-based) the English page starts the section on.
function sectionLine(): number {
  return readPage("en").split("\n").indexOf("### Custom roles");
}

describe("the custom roles section", () => {
  test("sits under Permissions, after the granular permissions", () => {
    const page: string = readPage("en");

    expect(page.indexOf("### Granular permissions")).toBeLessThan(
      page.indexOf("### Custom roles"),
    );
    expect(page.indexOf("### Custom roles")).toBeLessThan(
      page.indexOf("### Allow and block"),
    );
    expect(page).toContain(
      "| Custom role | A set of permissions you name once and give to teams and API keys. |",
    );
  });

  test.each([...SUPPORTED_DOCS_LANGUAGE_CODES])(
    "%s: has it, on the English page's line, with the same permissions named in code",
    (language: string) => {
      const lines: Array<string> = readPage(language).split("\n");
      const start: number = sectionLine();
      const end: number = lines.findIndex(
        (line: string, index: number): boolean => {
          return index > start && line.startsWith("### ");
        },
      );
      const section: string = lines.slice(start, end).join("\n");

      expect(lines[start]).toMatch(/^### \S/);
      expect(section.match(/`[^`]+`/g)).toEqual([
        "`IncidentMember`",
        "`AlertMember`",
        "`OnCallViewer`",
        "`ProjectOwner`",
      ]);
    },
  );
});

describe("what the section says", () => {
  test("its example is made of built-in roles a custom role may hold", () => {
    const roles: Array<Permission> =
      PermissionHelper.getRolePermissionProps().map(
        (props: PermissionProps): Permission => {
          return props.permission;
        },
      );

    for (const role of EXAMPLE_ROLES) {
      expect(roles).toContain(role);
      expect(isPermissionAllowedInCustomRole(role)).toBe(true);
    }
  });

  test("a role never holds Project Owner", () => {
    expect(PERMISSIONS_NEVER_IN_A_CUSTOM_ROLE).toEqual([
      Permission.ProjectOwner,
    ]);
    expect(isPermissionAllowedInCustomRole(Permission.ProjectOwner)).toBe(
      false,
    );
    expect(englishSection()).toContain("A role never holds `ProjectOwner`");
  });

  test("custom roles take the plan changing a team's permissions takes", () => {
    const teamPlan: PlanType | null =
      new TeamPermission().getCreateBillingPlan();

    expect(teamPlan).toBe(PlanType.Scale);

    for (const model of [
      new CustomRole(),
      new CustomRolePermission(),
      new TeamCustomRole(),
      new ApiKeyCustomRole(),
    ]) {
      expect(model.getCreateBillingPlan()).toBe(teamPlan);
    }

    expect(englishSection()).toContain(
      "On OneUptime Cloud, custom roles need the Scale plan, as changing a team's permissions does.",
    );
  });

  test("API keys take custom roles: a key is given one, and holds copies of its permissions", () => {
    const pointingAtARole: Array<string> = Entities.map(
      (modelType: { new (): DatabaseBaseModel }): DatabaseBaseModel => {
        return new modelType();
      },
    )
      .filter((model: DatabaseBaseModel): boolean => {
        return model.getTableColumns().columns.includes("customRoleId");
      })
      .map((model: DatabaseBaseModel): string => {
        return model.tableName || "";
      })
      .sort();

    expect(pointingAtARole).toEqual([
      "ApiKeyCustomRole",
      "ApiKeyPermission",
      "CustomRolePermission",
      "TeamCustomRole",
      "TeamPermission",
    ]);

    // A key's copy names the role, the role given to the key and the role's row, as a team's does.
    const keyColumns: Array<string> = new ApiKeyPermission().getTableColumns()
      .columns;

    for (const column of [
      "customRoleId",
      "apiKeyCustomRoleId",
      "customRolePermissionId",
    ]) {
      expect(keyColumns).toContain(column);
    }

    expect(englishSection()).toContain(
      "A custom role is a set of permissions you name once and give to teams and API keys",
    );
    expect(englishSection()).toContain(
      "- An API key gets every permission of its custom roles, with the same labels, as if the key held them itself, and a block on the key still wins.",
    );
    expect(englishSection()).not.toContain(
      "API keys do not take custom roles.",
    );
  });

  test("a permission limited to what someone owns gives a key nothing, and the section says so", () => {
    const plan: string = fs.readFileSync(
      path.join(REPO_ROOT, "Common/Types/Team/CustomRoleCopyPlan.ts"),
      "utf8",
    );

    expect(plan).toContain("isRolePermissionGivenToApiKeys");
    expect(englishSection()).toContain(
      "A permission the role limits to what someone owns gives a key nothing: a key owns nothing.",
    );
  });

  test("a role's permissions are changed on the role, not on a team or a key: their copies refuse a change", () => {
    for (const file of [
      "Common/Server/Services/TeamPermissionService.ts",
      "Common/Server/Services/ApiKeyPermissionService.ts",
    ]) {
      const service: string = fs.readFileSync(
        path.join(REPO_ROOT, file),
        "utf8",
      );

      expect(service).toContain("assertNoRoleCopies");
    }

    expect(englishSection()).toContain(
      "What a role gives is changed on the role's page, not on the team's or the key's.",
    );
  });
});

describe("the labels the steps name", () => {
  /*
   * Each bold label of the section, with the Dashboard source that draws it
   * - so a renamed button fails here, not in a reader's hands. The custom
   * role screens themselves (the Roles table, the create form, a role's
   * page, a team's custom roles) are Enterprise screens in
   * ee/Dashboard/CustomRoles, which core CI never sees:
   * ee/Tests/Server/CustomRoles/CustomRolesDocsLabels.test.ts holds the
   * labels they draw to this section.
   */
  const DRAWN_BY: ReadonlyArray<{
    label: string;
    file: string;
    source: string;
  }> = [
    {
      label: "Roles",
      file: "Pages/Teams/SideMenu.tsx",
      source: 'title: "Roles"',
    },
    {
      label: "Built-in Roles",
      file: "Components/CustomRole/BuiltInRolesCard.tsx",
      source: 'title="Built-in Roles"',
    },
  ];

  test.each(DRAWN_BY)(
    "$label is in the section, and drawn by $file",
    (entry: { label: string; file: string; source: string }) => {
      expect(englishSection()).toContain(`**${entry.label}**`);
      expect(readSource(entry.file)).toContain(entry.source);
    },
  );

  test("Create Team and Create API Key offer the custom roles under Access", () => {
    const teams: string = readSource("Pages/Teams/Index.tsx");
    const apiKeys: string = readSource("Pages/Settings/APIKeys.tsx");

    expect(teams).toContain("getCustomRoleAccessValue(role.id)");
    expect(apiKeys).toContain("getCustomRoleAccessValue(role.id)");
    expect(englishSection()).toContain(
      "**Create Team** and **Create API Key** offer the custom roles you could give under **Access**",
    );
  });

  /*
   * The card itself is an Enterprise screen (ee/Dashboard/CustomRoles
   * /ApiKeyCustomRoleTable): ee/Tests/Server/CustomRoles
   * /CustomRolesDocsLabels.test.ts holds its Add Custom Role. The key's
   * page draws it through core's shell.
   */
  test("an API key's page has Add Custom Role, as a team's Permissions page does", () => {
    const apiKeyPage: string = readSource("Pages/Settings/APIKeyView.tsx");

    expect(apiKeyPage).toContain("<ApiKeyCustomRolesSettings");
    expect(apiKeyPage).toContain("apiKeyId={modelId}");
    expect(englishSection()).toContain(
      "A team's **Permissions** page and an API key's page have **Add Custom Role** too",
    );
  });
});

/*
 * Roles moved from beside All Teams into the Teams menu's Settings section
 * (the maintainer: "Move the roles page to the settings side menu"), which
 * starts folded on All Teams. The first step leads there: Teams from the
 * Products menu's Settings, then the side menu's own Settings, opened,
 * then Roles.
 */
describe("where the steps find Roles", () => {
  const TEAMS_MENU: string = "Pages/Teams/SideMenu.tsx";

  // The section's first step, in a language: the line the English page has it on.
  function firstStep(language: string): string {
    const lines: Array<string> = readPage(language).split("\n");
    const english: Array<string> = readPage("en").split("\n");
    const start: number = sectionLine();
    const index: number = english.findIndex(
      (line: string, at: number): boolean => {
        return at > start && line.startsWith("1. ");
      },
    );

    expect(index).toBeGreaterThan(start);

    return lines[index] || "";
  }

  function boldCount(line: string, label: string): number {
    return line.split(`**${label}**`).length - 1;
  }

  test("the Teams menu draws Roles in its Settings section, first, and All Teams alone under Teams", () => {
    const menu: Array<MenuSection> = menuSections(readSource(TEAMS_MENU));

    expect(sectionByTitle(menu, "Teams").items).toEqual(["All Teams"]);
    expect(sectionByTitle(menu, "Settings").items).toEqual([
      "Roles",
      "Custom Fields",
    ]);
  });

  test("Settings starts folded on All Teams, so the first step opens it before choosing Roles", () => {
    expect(readSource(TEAMS_MENU)).toContain(
      "defaultCollapsed: !isOnSettingsPage",
    );
    expect(englishSection()).toContain(
      "1. Open **Teams** from the **Products** menu, under **Settings**. Expand **Settings** in its side menu, choose **Roles**, and click **Create Custom Role**.",
    );
    // The old way there, beside All Teams, is gone.
    expect(englishSection()).not.toContain(
      "under **Settings**, then **Roles**",
    );
  });

  test.each([...SUPPORTED_DOCS_LANGUAGE_CODES])(
    "%s: the first step names Settings twice - the Products menu's, then the side menu's - before Roles",
    (language: string) => {
      const step: string = firstStep(language);
      const settings: string = drawnActionLabel(language, "Settings");
      const roles: string = drawnActionLabel(language, "Roles");
      const createRole: string = `**${drawnActionLabel(language, "Create Custom Role")}**`;

      expect({ language, settings: boldCount(step, settings) }).toEqual({
        language,
        settings: 2,
      });
      expect({ language, roles: boldCount(step, roles) }).toEqual({
        language,
        roles: 1,
      });
      // The side menu's Settings comes before Roles, and Roles before the button.
      expect(step.lastIndexOf(`**${settings}**`)).toBeLessThan(
        step.indexOf(`**${roles}**`),
      );
      expect(step.indexOf(`**${roles}**`)).toBeLessThan(
        step.indexOf(createRole),
      );
    },
  );
});

/*
 * "Move custom roles to More settings because it is an advanced feature." -
 * the maintainer. A team's Permissions page and an API key's page draw
 * their custom roles card folded under More settings, after what the team
 * or key can do itself; the docs say where it is, in every language, by
 * the fold's own name as that language's Dashboard draws it.
 */
describe("where a team's and a key's custom roles are", () => {
  test("both pages fold the card under More settings, after their own permissions", () => {
    const teamPage: string = readSource("Pages/Teams/View/Permissions.tsx");
    const apiKeyPage: string = readSource("Pages/Settings/APIKeyView.tsx");

    for (const [page, shell, permissions] of [
      [teamPage, "<TeamCustomRolesSettings", "<TeamPermissionTable"],
      [apiKeyPage, "<ApiKeyCustomRolesSettings", "<ApiKeyPermissionTable"],
    ] as Array<[string, string, string]>) {
      const fold: number = page.indexOf("<AdvancedPageSection");

      expect(page.indexOf(permissions)).toBeLessThan(fold);
      expect(fold).toBeLessThan(page.indexOf(shell));
      expect(page.indexOf(shell)).toBeLessThan(
        page.indexOf("</AdvancedPageSection>"),
      );
    }
  });

  test("the English section says so", () => {
    expect(englishSection()).toContain(
      "have **Add Custom Role** too, under **More settings**,",
    );
    expect(englishSection()).toContain(
      "list their custom roles under **More settings**, after their own permissions",
    );
    expect(englishSection()).not.toContain("above their own permissions");
    expect(readPage("en")).toContain(
      "On a key's page, **Custom Roles**, under **More settings**, lists the key's custom roles",
    );
  });

  test.each([...SUPPORTED_DOCS_LANGUAGE_CODES])(
    "%s: the step, the bullet and the key's paragraph name More settings as its Dashboard draws it",
    (language: string) => {
      const lines: Array<string> = readPage(language).split("\n");
      const english: Array<string> = readPage("en").split("\n");
      const moreSettings: string = `**${drawnDashboardLabel(language, "More settings")}**`;

      for (const englishLine of [
        "have **Add Custom Role** too, under **More settings**,",
        "list their custom roles under **More settings**, after their own permissions",
        "On a key's page, **Custom Roles**, under **More settings**, lists",
      ]) {
        const index: number = english.findIndex((line: string): boolean => {
          return line.includes(englishLine);
        });

        expect(index).toBeGreaterThan(0);
        expect({
          language,
          englishLine,
          says: (lines[index] || "").includes(moreSettings),
        }).toEqual({ language, englishLine, says: true });
      }
    },
  );
});
