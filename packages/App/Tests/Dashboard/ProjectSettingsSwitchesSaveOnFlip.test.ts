import CustomerSupportAccessSwitchCopy, {
  CUSTOMER_SUPPORT_ACCESS_SWITCH_COLUMN,
} from "../../FeatureSet/Dashboard/src/Components/Project/CustomerSupportAccessSwitchCopy";
import MonitorGroupsSwitchCopy, {
  MONITOR_GROUPS_SWITCH_COLUMN,
} from "../../FeatureSet/Dashboard/src/Components/MonitorGroup/MonitorGroupsSwitchCopy";
import RequireSsoForLoginSwitchCopy, {
  REQUIRE_SSO_FOR_LOGIN_SWITCH_COLUMN,
} from "../../FeatureSet/Dashboard/src/Components/Project/RequireSsoForLoginSwitchCopy";
import Project from "Common/Models/DatabaseModels/Project";
import { ColumnAccessControl } from "Common/Types/BaseDatabase/AccessControl";
import Permission from "Common/Types/Permission";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Project Settings' one-switch settings save the moment they are flipped.
 *
 * Three cards there each held a single yes or no behind an Edit dialog:
 * "Enable Customer Support Access" (Settings > Project), "Feature Flags"
 * with "Enable Monitor Groups" (Settings > Feature Flags, which reloaded
 * the whole dashboard after saving), and "SSO Settings" with "Force SSO for
 * Login" (Settings > SSO, whose help read "Please test SSO before you you
 * enable this feature."). Each is the shared ModelSwitchCard now:
 *
 *   - "Let OneUptime support access this project" asks, saying what it
 *     grants, before it lets support in; taking the access away saves at
 *     once;
 *   - "Monitor Groups" saves either way, and the dashboard's menus follow
 *     it without a reload (Utils/SelectedProjectSwitches, wired in App.tsx);
 *   - "Require SSO for Login" asks, with a red button, before it locks out
 *     everyone not signed in with SSO; turning it off saves at once.
 *
 * This holds the pages to that, so a page written later cannot quietly
 * bring an Edit dialog or the old wording back. The behaviour is tested in
 * Common/Tests/App/Dashboard (ProjectSettingsSwitchCards,
 * SelectedProjectSwitches, SsoPages); the one-switch cards left elsewhere
 * are listed in Common/Tests/UI/Components/Forms/OneSwitchCardsGuard.
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

// Source with comments dropped and whitespace collapsed.
function readSource(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\{\s*\}/g, "{}")
    .replace(/\s+/g, " ");
}

function readDashboard(relative: string): string {
  return readSource(path.join(DASHBOARD_SRC, relative));
}

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const SOURCE_FILE: RegExp = /\.tsx?$/;

function listSources(directory: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "Locales") {
        found.push(...listSources(full));
      }
    } else if (SOURCE_FILE.test(entry.name)) {
      found.push(full);
    }
  }

  return found;
}

function columnAccess(column: string): ColumnAccessControl {
  return new Project().getColumnAccessControlForAllColumns()[
    column
  ] as ColumnAccessControl;
}

describe("the Settings pages draw switches, not Edit dialogs", () => {
  test("Settings > Project: the support switch, where OneUptime bills, after Project Details", () => {
    const page: string = readDashboard("Pages/Settings/ProjectSettings.tsx");

    expect(page).toContain(
      "{BILLING_ENABLED && ( <CustomerSupportAccessCard projectId={ProjectUtil.getCurrentProjectId()!} /> )}",
    );
    expect(page.indexOf('name="Project Details"')).toBeLessThan(
      page.indexOf("<CustomerSupportAccessCard"),
    );
    expect(page).not.toContain("letCustomerSupportAccessProject");
    expect(page).not.toContain('name="Enable Customer Support Access"');
  });

  test("Settings > Feature Flags: the Monitor Groups switch, and no reload", () => {
    const page: string = readDashboard("Pages/Settings/FeatureFlags.tsx");

    expect(page).toContain(
      "<MonitorGroupsSwitchCard projectId={ProjectUtil.getCurrentProjectId()!} />",
    );
    expect(page).not.toContain("CardModelDetail");
    expect(page).not.toContain("Navigation.reload");
  });

  test("Settings > SSO: the Require SSO switch, after the link that tests SSO", () => {
    const page: string = readDashboard("Pages/Settings/SSO.tsx");

    expect(page).toContain(
      "<RequireSsoForLoginCard projectId={ProjectUtil.getCurrentProjectId()!} />",
    );
    expect(page.indexOf("Test Single Sign On (SSO)")).toBeLessThan(
      page.indexOf("<RequireSsoForLoginCard"),
    );
    expect(page).not.toContain("CardModelDetail");
    // The old help's doubled word is gone with the dialog.
    expect(page).not.toContain("you you");
  });
});

describe("the switch cards", () => {
  test("each writes its Project column through the shared switch card", () => {
    for (const [file, column] of [
      [
        "Components/Project/CustomerSupportAccessCard.tsx",
        "CUSTOMER_SUPPORT_ACCESS_SWITCH_COLUMN",
      ],
      [
        "Components/MonitorGroup/MonitorGroupsSwitchCard.tsx",
        "MONITOR_GROUPS_SWITCH_COLUMN",
      ],
      [
        "Components/Project/RequireSsoForLoginCard.tsx",
        "REQUIRE_SSO_FOR_LOGIN_SWITCH_COLUMN",
      ],
    ] as Array<[string, string]>) {
      const card: string = readDashboard(file);

      expect([file, card.includes("<ModelSwitchCard<Project>")]).toEqual([
        file,
        true,
      ]);
      expect([file, card.includes(`column={${column}}`)]).toEqual([file, true]);
    }

    expect(CUSTOMER_SUPPORT_ACCESS_SWITCH_COLUMN).toBe(
      "letCustomerSupportAccessProject",
    );
    expect(MONITOR_GROUPS_SWITCH_COLUMN).toBe(
      "isFeatureFlagMonitorGroupsEnabled",
    );
    expect(REQUIRE_SSO_FOR_LOGIN_SWITCH_COLUMN).toBe("requireSsoForLogin");
  });

  test("letting support in asks first, as a grant, never the other way", () => {
    const card: string = readDashboard(
      "Components/Project/CustomerSupportAccessCard.tsx",
    );

    expect(card).toContain(
      "getConfirmation={getAllowCustomerSupportAccessConfirmation}",
    );
    expect(card).toContain("if (!isTurningOn) { return undefined; }");
    expect(card).not.toContain("ButtonStyleType.DANGER");
  });

  test("requiring SSO asks first, as a danger, never the other way", () => {
    const card: string = readDashboard(
      "Components/Project/RequireSsoForLoginCard.tsx",
    );

    expect(card).toContain(
      "getConfirmation={getRequireSsoForLoginConfirmation}",
    );
    expect(card).toContain("if (!isTurningOn) { return undefined; }");
    expect(card).toContain("submitButtonType: ButtonStyleType.DANGER");
  });

  test("Monitor Groups never asks", () => {
    const card: string = readDashboard(
      "Components/MonitorGroup/MonitorGroupsSwitchCard.tsx",
    );

    expect(card).not.toContain("getConfirmation");
    expect(card).toContain("note={MonitorGroupsSwitchCopy.note}");
  });

  test("each switch starts where the column's default puts a new project: off", () => {
    for (const column of [
      CUSTOMER_SUPPORT_ACCESS_SWITCH_COLUMN,
      MONITOR_GROUPS_SWITCH_COLUMN,
      REQUIRE_SSO_FOR_LOGIN_SWITCH_COLUMN,
    ]) {
      expect([
        column,
        new Project().getTableColumnMetadata(column).defaultValue,
      ]).toEqual([column, false]);
    }
  });

  /*
   * Who the switches unlock for: the columns' own update permissions, which
   * the switch reads (PermissionGate.checkColumnUpdate) and the server
   * holds every write to. Pinned so the copy's promises stay true.
   */
  test("who may flip them is the columns' own update permissions", () => {
    expect(columnAccess(CUSTOMER_SUPPORT_ACCESS_SWITCH_COLUMN).update).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
    ]);
    expect(columnAccess(REQUIRE_SSO_FOR_LOGIN_SWITCH_COLUMN).update).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProject,
    ]);
    expect(columnAccess(MONITOR_GROUPS_SWITCH_COLUMN).update).toEqual([
      Permission.ProjectOwner,
      Permission.ManageProjectBilling,
      Permission.EditProject,
    ]);
  });
});

describe("the menus follow Monitor Groups without a reload", () => {
  test("App.tsx takes a saved Monitor Groups into the selected project, the project list and ProjectUtil", () => {
    const app: string = readDashboard("App.tsx");

    expect(app).toContain(
      'import useSelectedProjectSwitches from "./Utils/UseSelectedProjectSwitches";',
    );
    expect(app).toContain(
      "useSelectedProjectSwitches({ selectedProject: selectedProject, onProjectUpdated: (updated: Project): void => { setSelectedProject(updated);",
    );
    expect(app).toContain("ProjectUtil.setCurrentProject(updated);");
    expect(app).toContain(
      "return project._id?.toString() === updated._id?.toString() ? updated : project;",
    );
  });

  test("the selected project's switch columns are the ones the project list selects", () => {
    const helper: string = readDashboard("Utils/SelectedProjectSwitches.ts");
    const projectApi: string = readSource(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "Common",
        "Server",
        "API",
        "ProjectAPI.ts",
      ),
    );

    expect(helper).toContain("> = [MONITOR_GROUPS_SWITCH_COLUMN];");
    expect(projectApi).toContain("isFeatureFlagMonitorGroupsEnabled: true,");
  });

  test("the menus read Monitor Groups off the selected project", () => {
    expect(readDashboard("Pages/Monitor/SideMenu.tsx")).toContain(
      "props.project?.isFeatureFlagMonitorGroupsEnabled",
    );
    expect(readDashboard("Pages/StatusPages/View/SideMenu.tsx")).toContain(
      "const project: Project | null = ProjectUtil.getCurrentProject();",
    );
  });
});

describe("what the switches say", () => {
  test("the switches are named for what happens while they are on", () => {
    expect(CustomerSupportAccessSwitchCopy.switchTitle).toBe(
      "Let OneUptime support access this project",
    );
    expect(MonitorGroupsSwitchCopy.switchTitle).toBe("Monitor Groups");
    expect(RequireSsoForLoginSwitchCopy.switchTitle).toBe(
      "Require SSO for Login",
    );

    for (const title of [
      CustomerSupportAccessSwitchCopy.switchTitle,
      MonitorGroupsSwitchCopy.switchTitle,
      RequireSsoForLoginSwitchCopy.switchTitle,
    ]) {
      expect(title).not.toMatch(/^(Enable|Disable|Force)\b/);
    }
  });

  test("letting support in says what support can then do, and until when", () => {
    expect(CustomerSupportAccessSwitchCopy.allowConfirmDescription).toContain(
      "see and change everything in it",
    );
    expect(CustomerSupportAccessSwitchCopy.allowConfirmDescription).toContain(
      "until you turn this off",
    );
  });

  test("requiring SSO says who is locked out - the person flipping it included - and to test first", () => {
    const sentence: string =
      RequireSsoForLoginSwitchCopy.requireConfirmDescription;

    expect(sentence).toContain("Everyone in this project, you included");
    expect(sentence).toContain("locked out of the project");
    expect(sentence).toContain("test SSO with the link above first");
  });

  test("turning Monitor Groups off deletes nothing, and the switch says so", () => {
    expect(MonitorGroupsSwitchCopy.note).toContain(
      "Turning this off deletes no group.",
    );
  });
});

describe("the old wording is gone from the dashboard", () => {
  const sources: Array<string> = listSources(DASHBOARD_SRC);

  test.each([
    "Edit Feature Flags",
    "Enable Monitor Groups",
    "Monitor Groups Enabled",
    "Let Customer Support Access Project",
    "Enable Customer Support Access",
  ])("%s", (text: string) => {
    const using: Array<string> = sources
      .filter((file: string): boolean => {
        return readSource(file).includes(text);
      })
      .map((file: string): string => {
        return path.relative(DASHBOARD_SRC, file);
      });

    expect(using).toEqual([]);
  });

  /*
   * The status page's own "Force SSO for Login" card still carries the old
   * sentence: who may see a status page is the status page access task's,
   * which turns that card into one choice.
   */
  test("the doubled word in the old SSO help is only left on the status page's card", () => {
    const using: Array<string> = sources
      .filter((file: string): boolean => {
        return readSource(file).includes(
          "Please test SSO before you you enable this feature.",
        );
      })
      .map((file: string): string => {
        return path.relative(DASHBOARD_SRC, file).split(path.sep).join("/");
      });

    expect(
      using.filter((file: string): boolean => {
        return file !== "Pages/StatusPages/View/SSO.tsx";
      }),
    ).toEqual([]);
  });
});

describe("translations", () => {
  // New with this change: every locale has its own words for them.
  const strings: Array<string> = [
    CustomerSupportAccessSwitchCopy.cardTitle,
    CustomerSupportAccessSwitchCopy.cardDescription,
    CustomerSupportAccessSwitchCopy.switchTitle,
    CustomerSupportAccessSwitchCopy.switchOnDescription,
    CustomerSupportAccessSwitchCopy.switchOffDescription,
    CustomerSupportAccessSwitchCopy.allowConfirmTitle,
    CustomerSupportAccessSwitchCopy.allowConfirmDescription,
    CustomerSupportAccessSwitchCopy.allowConfirmButton,
    MonitorGroupsSwitchCopy.cardDescription,
    MonitorGroupsSwitchCopy.switchOnDescription,
    MonitorGroupsSwitchCopy.switchOffDescription,
    MonitorGroupsSwitchCopy.note,
    RequireSsoForLoginSwitchCopy.cardDescription,
    RequireSsoForLoginSwitchCopy.switchOnDescription,
    RequireSsoForLoginSwitchCopy.switchOffDescription,
    RequireSsoForLoginSwitchCopy.requireConfirmTitle,
    RequireSsoForLoginSwitchCopy.requireConfirmDescription,
    // Older keys the switches use, now translated everywhere.
    RequireSsoForLoginSwitchCopy.switchTitle,
    RequireSsoForLoginSwitchCopy.requireConfirmButton,
    MonitorGroupsSwitchCopy.cardTitle,
    MonitorGroupsSwitchCopy.switchTitle,
    RequireSsoForLoginSwitchCopy.cardTitle,
  ];

  const english: Record<string, unknown> = readLocale("en");

  test("en.json has every string, as itself", () => {
    for (const text of strings) {
      expect([text, english[text]]).toEqual([text, text]);
    }
  });

  test.each(OTHER_LOCALES)("%s translates every one", (locale: string) => {
    const entries: Record<string, unknown> = readLocale(locale);

    for (const text of strings) {
      const value: unknown = entries[text];

      expect([text, typeof value]).toEqual([text, "string"]);
      expect([text, value === text]).toEqual([text, false]);
    }

    // OneUptime and SSO keep their names in every language.
    for (const text of strings) {
      const value: string = entries[text] as string;

      if (text.includes("OneUptime")) {
        expect([text, value.includes("OneUptime")]).toEqual([text, true]);
      }

      if (text.includes("SSO")) {
        expect([text, value.includes("SSO")]).toEqual([text, true]);
      }
    }
  });
});
