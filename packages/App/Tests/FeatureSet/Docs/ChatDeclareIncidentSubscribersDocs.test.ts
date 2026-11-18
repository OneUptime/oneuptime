import WorkspaceIncidentSubscriberNotification, {
  WORKSPACE_NOTIFY_SUBSCRIBERS_TEXT,
} from "Common/Server/Utils/Workspace/WorkspaceIncidentSubscriberNotification";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  DocsLink,
  DocsPageLink,
  anchorsOf,
  parseDocsLink,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHAT THE SLACK AND MICROSOFT TEAMS PAGES SAY OF STATUS PAGE SUBSCRIBERS ON
 * AN INCIDENT DECLARED FROM CHAT, HELD TO WHAT THE FORMS DO (#7917, #7916).
 *
 * "Creating incidents and maintenance from ..." has a bullet on Notify
 * Status Page Subscribers: the forms ask it right after the monitors, in the
 * words they draw, starting as the project starts the Dashboard's box; not
 * for a private alert's incident; and the confirmation says who will be
 * told, or why not. Each claim is held here to the code that makes it true
 * (WorkspaceIncidentSubscriberNotification, the two forms), and in every
 * docs language the bullet stands where the English one does, names the box
 * as the forms draw it - in English, as every chat form field - and links
 * to the section of the settings page that has the switch.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

const SETTINGS_PAGE: string = "incidents/settings";
const DECLARING_PAGE: string = "incidents/declaring-incidents";
const SUBSCRIBERS_LEAD: string = "Status page subscribers.";
const ENGLISH_SECTION: string = "subscriber-notifications";

const PAGES: Array<{ name: string; page: string; noun: string }> = [
  { name: "Slack", page: "workspace-connections/slack", noun: "box" },
  {
    name: "Microsoft Teams",
    page: "workspace-connections/microsoft-teams",
    noun: "toggle",
  },
];

/*
 * The bullet after the alert's own channel's, which follows the one that
 * links to AI SRE: where the English page puts the subscribers' bullet.
 */
function subscribersBullet(language: string, page: string): string {
  const lines: Array<string> = readPage(language, page).split("\n");
  const about: number = lines.findIndex((line: string): boolean => {
    return line.startsWith("- **") && line.includes("/docs/ai/ai-sre#");
  });

  expect(about).toBeGreaterThan(-1);
  return lines[about + 2] || "";
}

/*
 * The anchor of the settings page's section with the switch, in a
 * language: where the Declare page's Notify bullet - the one that names the
 * incident's column - links on the settings page.
 */
function switchSection(language: string): string | undefined {
  const declaring: string = readPage(language, DECLARING_PAGE);
  const lines: Array<string> = declaring.split("\n");
  const notifyLine: number =
    lines.findIndex((line: string): boolean => {
      return (
        line.startsWith("- **") &&
        line.includes(
          "`shouldStatusPageSubscribersBeNotifiedOnIncidentCreated`",
        )
      );
    }) + 1;

  return scanMarkdown(declaring)
    .links.filter((link: DocsLink): boolean => {
      return link.line === notifyLine;
    })
    .map((link: DocsLink): DocsPageLink | null => {
      return parseDocsLink(link.target);
    })
    .filter((target: DocsPageLink | null): target is DocsPageLink => {
      return target?.page === SETTINGS_PAGE && Boolean(target.anchor);
    })
    .map((target: DocsPageLink): string => {
      return target.anchor as string;
    })[0];
}

describe.each(PAGES)(
  "$name: the bullet on status page subscribers, in English",
  (row: { name: string; page: string; noun: string }) => {
    const bullet: string = subscribersBullet("en", row.page);

    test("leads with what it is about, and names the box as the form draws it", () => {
      expect(bullet.startsWith(`- **${SUBSCRIBERS_LEAD}**`)).toBe(true);
      expect(bullet).toContain(`**${WORKSPACE_NOTIFY_SUBSCRIBERS_TEXT.box}**`);
    });

    test("says it comes right after the monitors, as each form places it", () => {
      expect(bullet).toContain("right after its monitors");

      // Slack: after Change Monitor Status to, before the on-call policies.
      const slack: string = readSource(
        "Common/Server/Utils/Workspace/Slack/Actions/Incident.ts",
      );
      const slackBox: number = slack.indexOf(
        "blocks.push(notifySubscribersBox);",
      );
      expect(slackBox).toBeGreaterThan(
        slack.indexOf("blocks.push(monitorStatusDropdown);"),
      );
      expect(slackBox).toBeLessThan(
        slack.indexOf("blocks.push(onCallPolicyDropdown);"),
      );

      // Teams: after Change Monitor Status To, before the on-call policies.
      const teams: string = readSource(
        "Common/Server/Utils/Workspace/MicrosoftTeams/Actions/Incident.ts",
      );
      const teamsToggle: number = teams.indexOf('type: "Input.Toggle"');
      expect(teamsToggle).toBeGreaterThan(teams.indexOf('id: "monitorStatus"'));
      expect(teamsToggle).toBeLessThan(
        teams.indexOf('id: "onCallDutyPolicies"'),
      );
    });

    test("says it starts as the project starts the box, linking to the section with the switch", () => {
      expect(bullet).toContain(
        `[Subscriber notifications](/docs/${SETTINGS_PAGE}#${ENGLISH_SECTION})`,
      );
      expect(anchorsOf("en", SETTINGS_PAGE).has(ENGLISH_SECTION)).toBe(true);

      for (const isTickedByDefault of [true, false]) {
        expect(
          WorkspaceIncidentSubscriberNotification.getField({
            isTickedByDefault: isTickedByDefault,
            isPrivate: false,
          })?.isTickedByDefault,
        ).toBe(isTickedByDefault);
      }
    });

    test("says a private alert's incident is not asked about, as the form leaves the box off", () => {
      expect(bullet).toContain(
        "It is not asked for a private alert's incident, which no status page shows.",
      );
      expect(
        WorkspaceIncidentSubscriberNotification.getField({
          isTickedByDefault: true,
          isPrivate: true,
        }),
      ).toBeNull();
    });

    test("says what the confirmation says, reason by reason, as the line says it", () => {
      const text: typeof WORKSPACE_NOTIFY_SUBSCRIBERS_TEXT =
        WORKSPACE_NOTIFY_SUBSCRIBERS_TEXT;

      // Who will be told, by name; a page the person may not read, counted.
      expect(bullet).toContain(
        "whether status page subscribers will be notified",
      );
      expect(text.willNotify).toBe("Status page subscribers will be notified:");
      expect(bullet).toContain("is counted, never named");
      expect(text.hiddenPages).toContain("you do not have access to");

      // Or why not.
      expect(bullet).toContain(`the ${row.noun} was off`);
      expect(text.boxOffReason).toContain("was off");
      expect(bullet).toContain("the incident is private or has no monitors");
      expect(text.privateReason).toBe("the incident is private.");
      expect(text.noMonitorsReason).toContain("has no monitors");
      expect(bullet).toContain("no status page shows its monitors");
      expect(text.noStatusPageReason).toContain(
        "no status page shows this incident's monitors",
      );
      expect(bullet).toContain("those pages have no subscribers yet");
      expect(text.noSubscribersYet).toBe("no subscribers yet");

      // And how to tell them, when the box was off.
      expect(bullet).toContain("it also says how to tell them later");
      expect(text.boxOffHint).toContain("To tell them later");
    });
  },
);

describe.each(LANGUAGES)("the %s docs", (language: string) => {
  test.each(PAGES)(
    "$name: the bullet stands where the English one does, names the box as the form draws it, and links to the section with the switch",
    (row: { name: string; page: string }) => {
      const bullet: string = subscribersBullet(language, row.page);
      const section: string | undefined = switchSection(language);

      expect(bullet.startsWith("- **")).toBe(true);
      expect(bullet).toContain(`**${WORKSPACE_NOTIFY_SUBSCRIBERS_TEXT.box}**`);
      expect(section).toBeDefined();
      expect(anchorsOf(language, SETTINGS_PAGE).has(section!)).toBe(true);
      expect(bullet).toContain(`(/docs/${SETTINGS_PAGE}#${section!})`);
    },
  );
});
