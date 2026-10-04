import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";

/*
 * Admin Dashboard: adding someone to a project starts on its members team,
 * in one step.
 *
 *   - Projects > Users > Invite User looks the project's members team up
 *     when the dialog is asked for (Utils/DefaultProjectTeam: the Dashboard's
 *     rule, read through AdminModelAPI as a master admin, who may hand on
 *     any team) and opens with it picked, so Invite can be pressed on the
 *     first step. Its Team field says which team that is, in the words the
 *     Dashboard's Invite User uses.
 *   - Add to Project (one user, or many from the Users list) and a global
 *     provider's Attached Projects are one page, with the team picker
 *     starting on the members team; their step names and the bulk modal's
 *     Next are gone.
 *
 * The rendered behaviour is tested in Common (AdminAddToProjectMembersTeam,
 * ProjectScopedTeamsPicker, BulkAddUsersToProjectModal). These pin what only
 * the source and the locale files show: that the page really looks the team
 * up and hands it to the form, and that every Admin Dashboard language
 * carries the new sentence and none carries the retired keys.
 *
 * Source text rather than imports: these files render React, and App tests
 * stay React-free (Tests/FeatureSetImportsStayReactFree).
 */

const APP_FEATURE_SETS: string = nodePath.join(__dirname, "../../FeatureSet");
const ADMIN_DASHBOARD_SRC: string = nodePath.join(
  APP_FEATURE_SETS,
  "AdminDashboard/src",
);
const ADMIN_LOCALES: string = nodePath.join(ADMIN_DASHBOARD_SRC, "Locales");
const DASHBOARD_LOCALES: string = nodePath.join(
  APP_FEATURE_SETS,
  "Dashboard/src/Locales",
);

/*
 * Comments are stripped first so a file that explains a pattern in prose
 * cannot satisfy an assertion about the code.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function readSource(relativePath: string): string {
  return stripComments(
    fs.readFileSync(nodePath.join(ADMIN_DASHBOARD_SRC, relativePath), "utf8"),
  );
}

const inviteUserPage: string = readSource("Pages/Projects/View/Users.tsx");
const defaultProjectTeam: string = readSource("Utils/DefaultProjectTeam.ts");

const LOCALE_FILES: Array<string> = fs
  .readdirSync(ADMIN_LOCALES)
  .filter((name: string): boolean => {
    return name.endsWith(".json");
  })
  .sort();

function readLocale(directory: string, file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(nodePath.join(directory, file), "utf8"));
}

function lookUp(locale: Record<string, unknown>, key: string): unknown {
  let node: unknown = locale;

  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) {
      return undefined;
    }

    node = (node as Record<string, unknown>)[part];
  }

  return node;
}

const INVITE_TEAM_KEY: string =
  "pages.projectUsers.inviteTeamDescriptionWithDefault";

// The Dashboard's Invite User says the same, under its English text.
const DASHBOARD_INVITE_TEAM_SENTENCE: string =
  "Their team decides what they can do in this project. {{teamName}} is picked to start with; choose another team to give them different access.";

const RETIRED_KEYS: Array<string> = [
  "pages.userProjects.stepProject",
  "pages.userProjects.stepTeam",
  "pages.users.bulkAddToProjectNext",
  "pages.users.bulkAddToProjectStepProject",
  "pages.users.bulkAddToProjectStepTeam",
];

describe("Projects > Users > Invite User starts on the members team", () => {
  test("the dialog is opened by looking the team up first, and the button waits for it", () => {
    const opener: string = inviteUserPage.slice(
      inviteUserPage.indexOf("const openInviteUserModal"),
      inviteUserPage.indexOf("const inviteInitialValues"),
    );

    expect(opener).toMatch(
      /setIsPreparingInvite\(true\);\s*const team: InviteTeam \| null = await findProjectDefaultTeam\(\{\s*projectId: projectId,?\s*\}\);\s*setDefaultInviteTeam\(team\);\s*setIsPreparingInvite\(false\);\s*setShowInviteUserModal\(true\);/,
    );

    expect(inviteUserPage).toMatch(/isLoading: isPreparingInvite,/);
    expect(inviteUserPage).toMatch(
      /onClick: \(\) => \{\s*if \(isPreparingInvite\) \{\s*return;\s*\}\s*void openInviteUserModal\(\);\s*\}/,
    );
  });

  test("the form starts with the team it found", () => {
    expect(inviteUserPage).toMatch(
      /if \(!defaultInviteTeam\) \{\s*return undefined;\s*\}\s*return \{\s*team: defaultInviteTeam\.id,?\s*\} as FormValues<TeamMember>;/,
    );
    expect(inviteUserPage).toContain("initialValues={inviteInitialValues}");
  });

  test("the Team field says which team is picked, and says what it said before when none is", () => {
    expect(inviteUserPage).toMatch(
      /description: defaultInviteTeam\s*\?\s*t\("pages\.projectUsers\.inviteTeamDescriptionWithDefault", \{\s*teamName: defaultInviteTeam\.name,?\s*\}\)\s*:\s*"Select the team you would like to add this user to\.",/,
    );
  });

  test("the lookup is a master admin's: the admin API, and every team may be handed on", () => {
    expect(defaultProjectTeam).toContain(
      'import AdminModelAPI from "./ModelAPI";',
    );
    expect(defaultProjectTeam).toMatch(
      /modelAPI: AdminModelAPI,\s*canGrantAll: masterAdminCanGrantAll,/,
    );
  });
});

describe("the Admin Dashboard's languages", () => {
  test("all seventeen are read", () => {
    expect(LOCALE_FILES).toHaveLength(17);
  });

  test.each(LOCALE_FILES)(
    "%s says which team Invite User starts on, naming it",
    (file: string) => {
      const value: unknown = lookUp(
        readLocale(ADMIN_LOCALES, file),
        INVITE_TEAM_KEY,
      );

      expect(typeof value).toBe("string");
      expect((value as string).trim().length).toBeGreaterThan(20);
      expect((value as string).match(/\{\{[^}]+\}\}/g)).toEqual([
        "{{teamName}}",
      ]);
    },
  );

  test.each(LOCALE_FILES)(
    "%s words it as the Dashboard's Invite User does",
    (file: string) => {
      const dashboard: unknown = readLocale(DASHBOARD_LOCALES, file)[
        DASHBOARD_INVITE_TEAM_SENTENCE
      ];

      expect(typeof dashboard).toBe("string");
      expect(lookUp(readLocale(ADMIN_LOCALES, file), INVITE_TEAM_KEY)).toBe(
        dashboard,
      );
    },
  );

  test.each(LOCALE_FILES)(
    "%s no longer carries the step names and Next of the two-step forms",
    (file: string) => {
      const locale: Record<string, unknown> = readLocale(ADMIN_LOCALES, file);

      expect(
        RETIRED_KEYS.filter((key: string): boolean => {
          return lookUp(locale, key) !== undefined;
        }),
      ).toEqual([]);
    },
  );

  test("no Admin Dashboard source asks for a retired key", () => {
    const sources: Array<string> = [
      readSource("Pages/Users/View/Projects.tsx"),
      readSource("Components/User/BulkAddUsersToProjectModal.tsx"),
      readSource("Pages/Users/Index.tsx"),
    ];

    for (const source of sources) {
      for (const key of RETIRED_KEYS) {
        expect(source).not.toContain(`"${key}"`);
      }
    }
  });
});
