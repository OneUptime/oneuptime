import { TEST_NOTIFICATION_PERMISSION_MESSAGE } from "Common/Server/API/WorkspaceNotificationRuleAPI";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import WorkspaceNotificationRule from "Common/Models/DatabaseModels/WorkspaceNotificationRule";
import AlertInternalNote from "Common/Models/DatabaseModels/AlertInternalNote";
import AlertEpisodeInternalNote from "Common/Models/DatabaseModels/AlertEpisodeInternalNote";
import IncidentEpisodeInternalNote from "Common/Models/DatabaseModels/IncidentEpisodeInternalNote";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Three checks the server makes, and the guides that describe them:
 *
 *  - Test Rule on a Slack or Microsoft Teams notification rule needs the
 *    permission a channel's Send Test needs (create notification rules) and,
 *    on OneUptime Cloud, the Growth plan;
 *  - a status page's Require SSO for Login needs Scale to turn on, and turns
 *    off on every plan;
 *  - a state change of an alert or an episode sent with a private note needs
 *    the note's own permission, or it is refused whole.
 *
 * Markdown is not compiled, so this reads the code the guides quote - the
 * plans, the permission titles, the refusal - and checks every language
 * still says it.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");

const ALL_LANGUAGES: Array<string> = fs
  .readdirSync(CONTENT_DIR, { withFileTypes: true })
  .filter((entry: fs.Dirent): boolean => {
    return entry.isDirectory();
  })
  .map((entry: fs.Dirent): string => {
    return entry.name;
  })
  .sort();

function readGuide(language: string, page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, page), "utf8");
}

// A section, from its heading to the next heading of the same level or above.
function sectionOf(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.indexOf(heading);

  expect(`${heading}: ${start >= 0}`).toBe(`${heading}: true`);

  const level: number = heading.indexOf(" ");
  const section: Array<string> = [];

  for (const line of lines.slice(start + 1)) {
    const match: RegExpMatchArray | null = line.match(/^(#{1,6}) /);

    if (match && match[1]!.length <= level) {
      break;
    }

    section.push(line);
  }

  return section.join("\n");
}

function permissionTitle(permission: Permission): string {
  return PermissionHelper.getPermissionTitles([permission])[0]!;
}

const WORKSPACE_PAGES: Array<[string, string]> = [
  ["workspace-connections/slack.md", "Slack"],
  ["workspace-connections/microsoft-teams.md", "Microsoft Teams"],
];

describe("Test Rule, in the Slack and Microsoft Teams guides", () => {
  // What the server asks, read from the code.
  const createRulePermissions: Array<string> = new WorkspaceNotificationRule()
    .getCreatePermissions()
    .map(permissionTitle);

  test("the plan the guides name is the rules' own", () => {
    expect(new WorkspaceNotificationRule().readBillingPlan).toBe(
      PlanType.Growth,
    );
  });

  test.each(WORKSPACE_PAGES)(
    "en/%s: who may test a rule, what the others are told, and the plan",
    (page: string, name: string) => {
      const section: string = sectionOf(
        readGuide("en", page),
        "## Testing a rule",
      );

      expect(section).toContain(
        "**Test Rule** on a rule's row posts a test message for that rule to the channels it names",
      );
      expect(section).toContain(
        `Like **Send Test** beside a channel in **Project Settings** > **Workspace** > **${name}**, it needs permission to create notification rules`,
      );

      for (const title of [
        "Project Owner",
        "Project Admin",
        "Project Member",
        "Settings Admin",
        "Settings Member",
        "Create Workspace Notification Rule",
      ]) {
        expect([title, createRulePermissions.includes(title)]).toEqual([
          title,
          true,
        ]);
        expect(section).toContain(`**${title}**`);
      }

      // The rule is read as the caller, so a custom role needs its read too.
      expect(section).toContain(
        "or **Create Workspace Notification Rule** and **Read Workspace Notification Rule** in a custom role.",
      );
      expect(
        new WorkspaceNotificationRule()
          .getReadPermissions()
          .map(permissionTitle),
      ).toContain("Read Workspace Notification Rule");

      // Locked for those who may not; the API's refusal is the server's own.
      expect(section).toContain(
        "For someone who can only see the rules, such as a **Viewer**, **Test Rule** is locked, and its tooltip says what it takes",
      );
      expect(section).toContain(
        `the API refuses their test with "${TEST_NOTIFICATION_PERMISSION_MESSAGE}"`,
      );
      expect(section).toContain(
        "On OneUptime Cloud, testing a rule needs the **Growth** plan, like adding one.",
      );
    },
  );

  test.each(WORKSPACE_PAGES)(
    "every language's %s says who may test a rule, and the plan",
    (page: string) => {
      for (const language of ALL_LANGUAGES) {
        const guide: string = readGuide(language, page);

        expect([
          language,
          guide.includes("**Create Workspace Notification Rule**"),
        ]).toEqual([language, true]);
        expect([
          language,
          guide.includes("**Read Workspace Notification Rule**"),
        ]).toEqual([language, true]);
        expect([
          language,
          guide.includes(TEST_NOTIFICATION_PERMISSION_MESSAGE),
        ]).toEqual([language, true]);
        expect([language, guide.includes("**Growth**")]).toEqual([
          language,
          true,
        ]);
        expect([language, guide.includes("**Viewer**")]).toEqual([
          language,
          true,
        ]);
      }
    },
  );
});

describe("Require SSO for Login on a status page, in the status pages guide", () => {
  test("the plan the guide names is the column's own", () => {
    expect(
      new StatusPage().getColumnBillingAccessControl("requireSsoForLogin"),
    ).toEqual(
      expect.objectContaining({
        create: PlanType.Scale,
        update: PlanType.Scale,
      }),
    );
  });

  test("en: turning it on needs Scale, off works on every plan, and a page left requiring it keeps requiring it", () => {
    const guide: string = readGuide("en", "status-pages/index.md");

    expect(guide).toContain(
      "On OneUptime Cloud, turning it on needs the **Scale** plan, and turning it off works on every plan.",
    );
    expect(guide).toContain(
      "A page that still requires SSO after a Scale trial ends, or after a move to a lower plan, keeps requiring it until someone turns it off",
    );
  });

  test("every language says it in the paragraph about the switch", () => {
    for (const language of ALL_LANGUAGES) {
      const paragraph: string | undefined = readGuide(
        language,
        "status-pages/index.md",
      )
        .split("\n")
        .find((line: string): boolean => {
          return line.includes("`requireSsoForLogin`");
        });

      expect([language, Boolean(paragraph)]).toEqual([language, true]);
      expect([language, paragraph!.includes("**Scale**")]).toEqual([
        language,
        true,
      ]);
      expect([language, paragraph!.includes("**SSO**")]).toEqual([
        language,
        true,
      ]);
      expect([language, paragraph!.includes("**OIDC**")]).toEqual([
        language,
        true,
      ]);
    }
  });
});

describe("the private note of an alert or episode state change, in Incident States & Severities", () => {
  const NOTE_PERMISSIONS: Array<string> = [
    permissionTitle(Permission.CreateAlertInternalNote),
    permissionTitle(Permission.CreateAlertEpisodeInternalNote),
    permissionTitle(Permission.CreateIncidentEpisodeInternalNote),
  ];

  test("the permissions the guide names are the notes' own create permissions", () => {
    expect(NOTE_PERMISSIONS).toEqual([
      "Create Alert Internal Note",
      "Create Alert Episode Internal Note",
      "Create Incident Episode Internal Note",
    ]);

    const createLists: Array<Array<Permission>> = [
      new AlertInternalNote().getCreatePermissions(),
      new AlertEpisodeInternalNote().getCreatePermissions(),
      new IncidentEpisodeInternalNote().getCreatePermissions(),
    ];

    expect(createLists[0]).toContain(Permission.CreateAlertInternalNote);
    expect(createLists[1]).toContain(Permission.CreateAlertEpisodeInternalNote);
    expect(createLists[2]).toContain(
      Permission.CreateIncidentEpisodeInternalNote,
    );
  });

  test("en: works the same way as the public note, refused whole", () => {
    const section: string = sectionOf(
      readGuide("en", "incidents/states-and-severities.md"),
      "## Telling status page subscribers about a state change",
    );

    expect(section).toContain(
      "Alerts, alert episodes and incident episodes offer a private note with a state change instead (**Add a private note**), and it works the same way",
    );
    expect(section).toContain(
      "a state change sent with a private note by someone without it is refused whole, so the state is not changed.",
    );
  });

  test("every language names the three permissions", () => {
    for (const language of ALL_LANGUAGES) {
      const guide: string = readGuide(
        language,
        "incidents/states-and-severities.md",
      );

      for (const title of NOTE_PERMISSIONS) {
        expect([language, title, guide.includes(`**${title}**`)]).toEqual([
          language,
          title,
          true,
        ]);
      }
    }
  });
});
