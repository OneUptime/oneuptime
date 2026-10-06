import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import ProjectSmtpConfig from "Common/Models/DatabaseModels/ProjectSmtpConfig";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import WorkspaceNotificationRule from "Common/Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceNotificationSummary from "Common/Models/DatabaseModels/WorkspaceNotificationSummary";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What sending a test asks, in the guides that name the buttons:
 *
 *  - Send Test beside a Slack or Microsoft Teams channel (or a Teams chat)
 *    asks what adding a notification rule asks, so on OneUptime Cloud it
 *    needs the rules' plan; Send Test Now on a summary asks what adding a
 *    summary asks;
 *  - Send Test Email asks what adding an SMTP config asks;
 *  - Send Test SMS and Send Test Call ask what adding a Twilio
 *    configuration asks;
 *  - Send Test Report asks what turning a status page's reports on asks.
 *
 * Markdown is not compiled, so this reads the code the guides quote - the
 * permission titles and the plans - and checks every language still says it.
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

function titlesOf(permissions: Array<Permission>): Array<string> {
  return PermissionHelper.getPermissionTitles(permissions).sort();
}

// Every language says the titles the English guide quotes, in bold.
function expectEveryLanguageNames(page: string, phrases: Array<string>): void {
  for (const language of ALL_LANGUAGES) {
    const guide: string = readGuide(language, page);

    for (const phrase of phrases) {
      expect([language, page, phrase, guide.includes(phrase)]).toEqual([
        language,
        page,
        phrase,
        true,
      ]);
    }
  }
}

describe("what the guides name is what the server asks", () => {
  test("a channel's Send Test asks what adding a notification rule asks, on the Growth plan", () => {
    expect(new WorkspaceNotificationRule().getCreateBillingPlan()).toBe(
      PlanType.Growth,
    );
  });

  test("a summary's Send Test Now asks what adding a summary asks, on the Growth plan", () => {
    const summary: WorkspaceNotificationSummary =
      new WorkspaceNotificationSummary();

    expect(summary.getCreateBillingPlan()).toBe(PlanType.Growth);
    expect(titlesOf(summary.getCreatePermissions())).toContain(
      "Create Workspace Notification Summary",
    );
    expect(titlesOf(summary.getReadPermissions())).toContain(
      "Read Workspace Notification Summary",
    );
  });

  test("Send Test Email: the roles the guide lists are every role that may add an SMTP config", () => {
    const config: ProjectSmtpConfig = new ProjectSmtpConfig();

    expect(titlesOf(config.getCreatePermissions())).toEqual([
      "Create SMTP Config",
      "Project Admin",
      "Project Owner",
    ]);
    expect(titlesOf(config.getReadPermissions())).toContain("Read SMTP Config");
    expect(config.getCreateBillingPlan()).toBe(PlanType.Growth);
  });

  test("Send Test SMS and Send Test Call: the roles the guide lists are every role that may add a Twilio configuration", () => {
    const config: ProjectCallSMSConfig = new ProjectCallSMSConfig();

    expect(titlesOf(config.getCreatePermissions())).toEqual([
      "Create Call and SMS",
      "Project Admin",
      "Project Owner",
    ]);
    expect(titlesOf(config.getReadPermissions())).toContain(
      "Read Call and SMS",
    );
  });

  test("Send Test Report: turning reports on needs the Growth plan", () => {
    expect(
      new StatusPage().getColumnBillingAccessControl("isReportEnabled"),
    ).toEqual(expect.objectContaining({ update: PlanType.Growth }));
  });
});

describe("the English guides", () => {
  test.each([
    ["workspace-connections/slack.md", "a channel"],
    ["workspace-connections/microsoft-teams.md", "a channel or a chat"],
  ])(
    "%s: a channel's Send Test, a summary's Send Test Now, and read-only MCP clients",
    (page: string, where: string) => {
      const guide: string = readGuide("en", page);

      expect(guide).toContain(
        `On OneUptime Cloud, **Send Test** beside ${where} needs the **Growth** plan too, since posting into a channel is what rules and summaries do.`,
      );
      expect(guide).toContain(
        "**Send Test Now** on a summary needs permission to create summaries (**Create Workspace Notification Summary** and **Read Workspace Notification Summary** in a custom role) and, on OneUptime Cloud, the **Growth** plan; for anyone else it is locked, and its tooltip says what it takes.",
      );
      expect(guide).toContain(
        "An MCP client connected with read-only access cannot send any test.",
      );
    },
  );

  test("emails/smtp.md: who may send a test email, and the plan", () => {
    expect(readGuide("en", "emails/smtp.md")).toContain(
      "Once a project config is saved, **Send Test Email** on its row checks that it works. It needs permission to add SMTP configs: **Project Owner**, **Project Admin**, or **Create SMTP Config** and **Read SMTP Config** in a custom role. On OneUptime Cloud it also needs the **Growth** plan, like adding a config. For anyone else it is locked, and its tooltip says what it takes.",
    );
  });

  test("self-hosted/twilio-integration.md: who may send a test SMS or call", () => {
    expect(readGuide("en", "self-hosted/twilio-integration.md")).toContain(
      "2. Use **Send Test SMS** and **Send Test Call** on the project's Twilio configuration. Confirm receipt on the destination phone. Both need permission to add Twilio configurations: **Project Owner**, **Project Admin**, or **Create Call and SMS** and **Read Call and SMS** in a custom role.",
    );
  });

  test("status-pages/subscribers.md: a test report asks what turning reports on asks", () => {
    expect(readGuide("en", "status-pages/subscribers.md")).toContain(
      "- **Send Test Report**, under the card, emails a report to an address you give, so you can see what subscribers get, whether reports are on or not. It needs what turning reports on needs: permission to edit the page and, on OneUptime Cloud, the **Growth** plan.",
    );
  });
});

describe("every language", () => {
  test.each([
    "workspace-connections/slack.md",
    "workspace-connections/microsoft-teams.md",
  ])("%s names what a summary's Send Test Now asks", (page: string) => {
    expectEveryLanguageNames(page, [
      "**Create Workspace Notification Summary**",
      "**Read Workspace Notification Summary**",
      "**Growth**",
      "MCP",
    ]);
  });

  test("emails/smtp.md names who may send a test email, and the plan", () => {
    expectEveryLanguageNames("emails/smtp.md", [
      "**Project Owner**",
      "**Project Admin**",
      "**Create SMTP Config**",
      "**Read SMTP Config**",
      "**Growth**",
    ]);
  });

  test("self-hosted/twilio-integration.md names who may send a test SMS or call", () => {
    expectEveryLanguageNames("self-hosted/twilio-integration.md", [
      "**Project Owner**",
      "**Project Admin**",
      "**Create Call and SMS**",
      "**Read Call and SMS**",
    ]);
  });
});
