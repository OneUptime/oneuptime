import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { readPage } from "./DocsContentSupport";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import { toLatinDigits } from "./DocsTranslationChecks";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import OnCallFeedText from "Common/Server/Utils/OnCall/OnCallFeedText";
import { ON_CALL_PAGE_LINK_TOKEN_EXPIRES_IN_SECONDS } from "Common/Server/Utils/OnCall/OnCallPageLinkToken";
import OnCallDutyExecutionLogTimelineStatus from "Common/Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import {
  CANT_TAKE_IT_ESCALATE,
  ESCALATE,
  ON_CALL_PAGE_CALL_PASS_ON_DIGIT,
  ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
  OnCallPassOnOutcome,
  getOnCallPageStatusLabel,
  getOnCallPassOnSentence,
} from "Common/Types/OnCallDutyPolicy/OnCallPagePassOn";
import UserNotificationExecutionStatus from "Common/Types/UserNotification/UserNotificationExecutionStatus";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import { mdText } from "Common/Utils/Markdown/FeedMarkdown";
import { ON_CALL_PAGE_SMS_ACTION } from "Common/Utils/Sms/OnCallPageSms";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * "ESCALATING A PAGE", IN THE DOCS (tasks oncall-page-pass-on and
 * escalate-incident-copy).
 *
 * Somebody paged who cannot take it escalates the page: the policy pages
 * its next level at once. The action was first called "Pass it on"; the
 * maintainer's copy renamed it Escalate, everywhere. The Escalation Rules
 * page says how, from every place a page reaches people, and what happens
 * next; Personal On-Call Rules says it beside acknowledging, and links
 * there. Markdown is not compiled, so these checks read what the page
 * states from the code that does it - the messages' words, the call's key,
 * the Dashboard's and the app's buttons, the link's lifetime, the sentences
 * quoted - and hold every docs language to the English page: the section in
 * its place, linked the same way, the Dashboard named as that language's
 * Dashboard draws it, the words only English messages carry kept in
 * English, and the old words gone.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");

const ESCALATION_PAGE: string = "on-call/escalation-rules";
const RULES_PAGE: string = "notifications/on-call-rules";

const SECTION_HEADING: string = "Escalating a page";
// The page's "## " sections: the section sits after the rotation's.
const ROTATION_SECTION: number = 3;
const PASS_ON_SECTION: number = 4;
const SECTION_COUNT: number = 8;

// The Dashboard's words the section names, bold, as each language draws them.
const DASHBOARD_LABELS: Array<string> = [
  "Escalate after (in minutes)",
  "Escalate",
  "Repeat Policy",
  "Execution Timeline",
  "Escalated",
  "On-Call Logs",
];

// What no page says any more: the action's first name, in English.
const OLD_WORDS: Array<string> = [
  "Pass it on",
  "pass it on",
  "Passing a page on",
  "passed on the page",
  "Passed On",
  "Escalation rule 2 of 3 (Level 2) is paged right away",
];

// The channels the section's table lists, in order.
const CHANNEL_ROWS: Array<string> = [
  "Email",
  "SMS and WhatsApp",
  "Telegram, Slack and Microsoft Teams",
  "Phone call",
  "Push notification",
  "OneUptime",
];

const EMAIL_TEMPLATES: Array<string> = [
  "AcknowledgeIncident",
  "AcknowledgeAlert",
  "AcknowledgeIncidentEpisode",
  "AcknowledgeAlertEpisode",
];

// What a preview says when the next level is paged: the sentence quoted.
const PREVIEW_SENTENCE: string = getOnCallPassOnSentence({
  outcome: OnCallPassOnOutcome.NextRulePaged,
  isPreview: true,
  isDirectPage: false,
  policyName: "Payments",
  rule: { order: 2, name: "Platform leads" },
  pagedNames: [],
  stillPagedNames: [],
  ruleCount: 3,
});

// The feed's entry for a pass, as a reader sees it: bold drawn, no stars.
const FEED_SENTENCE: string = OnCallFeedText.getStepMarkdown({
  status: OnCallDutyExecutionLogTimelineStatus.PassedOn,
  policyLink: mdText`Payments`,
  ruleName: "Level 1",
  ruleOrder: 1,
  ruleCount: 3,
  recipient: mdText`Alex Kim`,
  statusMessage: ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
})
  .split("**")
  .join("");

const SECONDS_IN_A_DAY: number = 24 * 60 * 60;

interface PageSection {
  heading: string;
  body: string;
}

function readRepoFile(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

// The page's "## " sections, by heading, with their text.
function sectionsOf(markdown: string): Array<PageSection> {
  return markdown
    .split(/^## /m)
    .slice(1)
    .map((part: string): PageSection => {
      const newline: number = part.indexOf("\n");

      return {
        heading: part.slice(0, newline).trim(),
        body: part.slice(newline + 1),
      };
    });
}

// The lines of a page holding a link to a heading of the escalation page.
function linesLinkingTo(
  markdown: string,
  heading: string,
  fromOtherPage: boolean,
): Array<string> {
  const target: string = `${fromOtherPage ? `/docs/${ESCALATION_PAGE}` : ""}#${slugifyMarkdownHeading(heading)})`;

  return markdown.split("\n").filter((line: string): boolean => {
    return line.includes(`](${target}`);
  });
}

// The first cell of each row of the table under the section.
function tableFirstCells(section: string): Array<string> {
  return section
    .split("\n")
    .filter((line: string): boolean => {
      return line.startsWith("| ") && !line.startsWith("| --- ");
    })
    .slice(1)
    .map((line: string): string => {
      return (line.split("|")[1] || "").trim();
    });
}

describe("the Escalation Rules page, on escalating a page", () => {
  const page: string = readPage("en", ESCALATION_PAGE);
  const sections: Array<PageSection> = sectionsOf(page);
  const section: string = sections[PASS_ON_SECTION]?.body || "";

  it("has a section of its own, right after the rotation's", () => {
    expect(sections).toHaveLength(SECTION_COUNT);
    expect(sections[ROTATION_SECTION]?.heading).toBe(
      "Escalating to the next person in the rotation",
    );
    expect(sections[PASS_ON_SECTION]?.heading).toBe(SECTION_HEADING);
  });

  it("is linked from the cards and from how the levels page people", () => {
    const linking: Array<string> = linesLinkingTo(page, SECTION_HEADING, false);

    expect(linking).toHaveLength(2);
    expect(linking[0]!.startsWith("- [")).toBe(true);
    expect(sections[2]!.body).toContain(
      "Somebody paged who cannot take it can escalate it, and the next level is paged without waiting: see [Escalating a page](#escalating-a-page).",
    );
  });

  it("lists every place a page reaches people, in order", () => {
    expect(tableFirstCells(section)).toEqual(CHANNEL_ROWS);
  });

  it("names the email's button as the four emails draw it", () => {
    for (const template of EMAIL_TEMPLATES) {
      const source: string = readRepoFile(
        `App/FeatureSet/Notification/Templates/${template}.hbs`,
      );

      expect({ template, button: source }).toEqual({
        template,
        button: expect.stringContaining(
          `{{> ButtonBlock buttonUrl=passOnLink buttonText="${ESCALATE}" secondary=true}}`,
        ),
      });
    }

    expect(section).toContain(
      `| Email | The **${ESCALATE}** button, then **${ESCALATE}** on the page it opens |`,
    );
  });

  it("says texts and WhatsApp open the acknowledge page, which offers it too", () => {
    const ruleService: string = readRepoFile(
      "Common/Server/Services/UserNotificationRuleService.ts",
    );
    const acknowledgePage: string = readRepoFile(
      "Common/Server/Views/AcknowledgeUserOnCallNotification.ejs",
    );

    // A text's one link, after "Ack or escalate:", is the acknowledge page's.
    expect(ON_CALL_PAGE_SMS_ACTION).toBe("Ack or escalate:");
    expect(page).toContain(
      `${ON_CALL_PAGE_SMS_ACTION} https://oneuptime.com/l/`,
    );
    expect(ruleService).toContain("message: this.buildOnCallPageSmsText({");
    expect(ruleService).toContain(
      "link: await this.buildOnCallAcknowledgeShortUrl(",
    );
    // WhatsApp's wording is a fixed template: its one link is the acknowledge page's.
    expect(ruleService).toContain(
      "acknowledge_url: acknowledgeUrl.toString(),",
    );
    expect(acknowledgePage).toContain(
      "include('./Partials/OnCallPassOnForm.ejs'",
    );
    expect(section).toContain(
      `| SMS and WhatsApp | The link in the message opens the acknowledge page, which has **${ESCALATE}** too |`,
    );
  });

  it("quotes the link Telegram, Slack and Microsoft Teams messages carry", () => {
    expect(CANT_TAKE_IT_ESCALATE).toBe("Can't take it? Escalate");
    expect(section).toContain(
      `| Telegram, Slack and Microsoft Teams | The "${CANT_TAKE_IT_ESCALATE}" link, then **${ESCALATE}** on the page it opens |`,
    );
  });

  it("gives the key a call asks for", () => {
    expect(section).toContain(
      `| Phone call | Press ${ON_CALL_PAGE_CALL_PASS_ON_DIGIT}. The call then says what happened |`,
    );
    expect(section).toContain(
      `on a call, pressing ${ON_CALL_PAGE_CALL_PASS_ON_DIGIT} is the answer.`,
    );
  });

  it("names the Dashboard's and the app's buttons as they are drawn", () => {
    expect(
      readRepoFile(
        "App/FeatureSet/Dashboard/src/Components/OnCallPolicy/PassOn/PassOnPage.ts",
      ),
    ).toContain(`button: translationKey("${ESCALATE}"),`);
    expect(readRepoFile("MobileApp/src/oncall/passOn.ts")).toContain(
      `button: "${ESCALATE}",`,
    );
    expect(section).toContain(
      `| OneUptime | **${ESCALATE}** at the top of the incident, alert or episode, after its state buttons |`,
    );
    expect(section).toContain(
      `opens in the OneUptime On-Call app, with **${ESCALATE}** under it |`,
    );
  });

  it("quotes what escalating will do as the server words it - the maintainer's sentence", () => {
    expect(PREVIEW_SENTENCE).toBe(
      "This will immediately page Platform leads (Level 2 of 3), without waiting.",
    );
    expect(section).toContain(`such as "${PREVIEW_SENTENCE}";`);
  });

  it("gives a link's lifetime as the token's", () => {
    expect(ON_CALL_PAGE_LINK_TOKEN_EXPIRES_IN_SECONDS % SECONDS_IN_A_DAY).toBe(
      0,
    );

    const days: number =
      ON_CALL_PAGE_LINK_TOKEN_EXPIRES_IN_SECONDS / SECONDS_IN_A_DAY;

    expect(section).toContain(
      `for the person it was sent to, for ${days} days.`,
    );
  });

  it("quotes the feed's entry, and names the statuses the lists show as they draw them", () => {
    expect(FEED_SENTENCE).toBe(
      "Alex Kim escalated the page from on-call policy Payments at Level 1 of 3.",
    );
    expect(section).toContain(`the incident's feed says "${FEED_SENTENCE}"`);

    // Stored as the action's first name; drawn as Escalated.
    for (const status of [
      OnCallDutyExecutionLogTimelineStatus.PassedOn,
      UserNotificationExecutionStatus.PassedOn,
      UserNotificationStatus.PassedOn,
    ]) {
      expect(status).toBe("Passed On");
      expect(getOnCallPageStatusLabel(status)).toBe("Escalated");
    }

    expect(section).toContain(
      "The run's **Execution Timeline** marks the person's line **Escalated**",
    );
    expect(section).toContain(
      "their **On-Call Logs** show the page as **Escalated**.",
    );
  });

  it("never says the old words", () => {
    for (const old of OLD_WORDS) {
      expect({ old, found: page.includes(old) }).toEqual({
        old,
        found: false,
      });
    }
  });
});

describe("Personal On-Call Rules, on escalating a page", () => {
  it("says it beside acknowledging, and links to the section", () => {
    const rules: string = readPage("en", RULES_PAGE);
    const linking: Array<string> = linesLinkingTo(rules, SECTION_HEADING, true);

    expect(linking).toHaveLength(1);
    expect(linking[0]).toContain(
      `and a call asks you to press 1. When you cannot take a page, the same messages let you escalate it, and a call asks you to press ${ON_CALL_PAGE_CALL_PASS_ON_DIGIT}:`,
    );
  });
});

describe.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
  "the %s pages, on escalating a page",
  (language: string) => {
    const page: string = readPage(language, ESCALATION_PAGE);
    const sections: Array<PageSection> = sectionsOf(page);
    const section: PageSection | undefined = sections[PASS_ON_SECTION];

    it("have the section in its place, linked from the cards, the levels and the rules page", () => {
      expect(sections).toHaveLength(SECTION_COUNT);
      expect(section).toBeDefined();
      expect(linesLinkingTo(page, section!.heading, false)).toHaveLength(2);
      expect(
        linesLinkingTo(readPage(language, RULES_PAGE), section!.heading, true),
      ).toHaveLength(1);
    });

    it("name the Dashboard as this language's Dashboard draws it", () => {
      const missing: Array<string> = DASHBOARD_LABELS.filter(
        (label: string): boolean => {
          return !section!.body.includes(
            `**${drawnDashboardLabel(language, label)}**`,
          );
        },
      );

      expect(missing).toEqual([]);
    });

    it("keep in English what only English messages and the app say", () => {
      const body: string = section!.body;

      for (const kept of [
        `**${ESCALATE}**`,
        CANT_TAKE_IT_ESCALATE,
        PREVIEW_SENTENCE,
        FEED_SENTENCE,
        "OneUptime On-Call",
      ]) {
        expect({ language, kept, found: body.includes(kept) }).toEqual({
          language,
          kept,
          found: true,
        });
      }
    });

    it("say none of the old English words, on the three pages that named them", () => {
      for (const pagePath of [
        ESCALATION_PAGE,
        RULES_PAGE,
        "incidents/settings",
      ]) {
        const markdown: string = readPage(language, pagePath);

        for (const old of OLD_WORDS) {
          expect({ pagePath, old, found: markdown.includes(old) }).toEqual({
            pagePath,
            old,
            found: false,
          });
        }
      }
    });

    it("give the call's key and the link's lifetime", () => {
      const body: string = toLatinDigits(section!.body);
      const days: string = String(
        ON_CALL_PAGE_LINK_TOKEN_EXPIRES_IN_SECONDS / SECONDS_IN_A_DAY,
      );

      expect(body).toContain(ON_CALL_PAGE_CALL_PASS_ON_DIGIT);
      expect(body).toContain(days);
    });
  },
);
