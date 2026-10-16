import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { readPage } from "./DocsContentSupport";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import { toLatinDigits } from "./DocsTranslationChecks";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import OnCallFeedText from "Common/Server/Utils/OnCall/OnCallFeedText";
import { ON_CALL_PAGE_LINK_TOKEN_EXPIRES_IN_SECONDS } from "Common/Server/Utils/OnCall/OnCallPageLinkToken";
import OnCallDutyExecutionLogTimelineStatus from "Common/Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import {
  CANT_TAKE_IT_PASS_IT_ON,
  ON_CALL_PAGE_CALL_PASS_ON_DIGIT,
  ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
  OnCallPassOnOutcome,
  PASS_IT_ON,
  getOnCallPassOnSentence,
} from "Common/Types/OnCallDutyPolicy/OnCallPagePassOn";
import UserNotificationExecutionStatus from "Common/Types/UserNotification/UserNotificationExecutionStatus";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import { mdText } from "Common/Utils/Markdown/FeedMarkdown";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * "PASSING A PAGE ON", IN THE DOCS (task oncall-page-pass-on).
 *
 * Somebody paged who cannot take it passes the page on: the policy pages
 * its next escalation rule at once. The Escalation Rules page says how, from
 * every place a page reaches people, and what happens next; Personal On-Call
 * Rules says it beside acknowledging, and links there. Markdown is not
 * compiled, so these checks read what the page states from the code that
 * does it - the messages' words, the call's key, the Dashboard's and the
 * app's buttons, the link's lifetime, the sentences quoted - and hold every
 * docs language to the English page: the section in its place, linked the
 * same way, the Dashboard named as that language's Dashboard draws it, and
 * the words only English messages carry kept in English.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");

const ESCALATION_PAGE: string = "on-call/escalation-rules";
const RULES_PAGE: string = "notifications/on-call-rules";

const SECTION_HEADING: string = "Passing a page on";
// The page's "## " sections: the section sits after the rotation's.
const ROTATION_SECTION: number = 3;
const PASS_ON_SECTION: number = 4;
const SECTION_COUNT: number = 8;

// The Dashboard's words the section names, bold, as each language draws them.
const DASHBOARD_LABELS: Array<string> = [
  "Escalate after (in minutes)",
  "Pass it on",
  "Repeat Policy",
  "Execution Timeline",
  "Passed On",
  "On-Call Logs",
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

// What a preview says when the next rule is paged: the sentence quoted.
const PREVIEW_SENTENCE: string = getOnCallPassOnSentence({
  outcome: OnCallPassOnOutcome.NextRulePaged,
  isPreview: true,
  isDirectPage: false,
  policyName: "Payments",
  rule: { order: 2, name: "Level 2" },
  pagedNames: [],
  stillPagedNames: [],
  ruleCount: 3,
});

// The feed's entry for a pass, as a reader sees it: bold drawn, no stars.
const FEED_SENTENCE: string = OnCallFeedText.getStepMarkdown({
  status: OnCallDutyExecutionLogTimelineStatus.PassedOn,
  policyLink: mdText`Payments`,
  ruleName: "Level 1",
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

describe("the Escalation Rules page, on passing a page on", () => {
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
      "Somebody paged who cannot take it can pass it on, and the next level is paged without waiting: see [Passing a page on](#passing-a-page-on).",
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
          `{{> ButtonBlock buttonUrl=passOnLink buttonText="${PASS_IT_ON}" secondary=true}}`,
        ),
      });
    }

    expect(section).toContain(
      `| Email | The **${PASS_IT_ON}** button, then **${PASS_IT_ON}** on the page it opens |`,
    );
  });

  it("says texts and WhatsApp open the acknowledge page, which offers it too", () => {
    const ruleService: string = readRepoFile(
      "Common/Server/Services/UserNotificationRuleService.ts",
    );
    const acknowledgePage: string = readRepoFile(
      "Common/Server/Views/AcknowledgeUserOnCallNotification.ejs",
    );

    expect(ruleService).toContain(
      "To acknowledge this incident, or pass it on if you can't take it, please click on the following link",
    );
    // WhatsApp's wording is a fixed template: its one link is the acknowledge page's.
    expect(ruleService).toContain(
      "acknowledge_url: acknowledgeUrl.toString(),",
    );
    expect(acknowledgePage).toContain(
      "include('./Partials/OnCallPassOnForm.ejs'",
    );
    expect(section).toContain(
      `| SMS and WhatsApp | The link in the message opens the acknowledge page, which has **${PASS_IT_ON}** too |`,
    );
  });

  it("quotes the link Telegram, Slack and Microsoft Teams messages carry", () => {
    expect(CANT_TAKE_IT_PASS_IT_ON).toBe("Can't take it? Pass it on");
    expect(section).toContain(
      `| Telegram, Slack and Microsoft Teams | The "${CANT_TAKE_IT_PASS_IT_ON}" link, then **${PASS_IT_ON}** on the page it opens |`,
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
    ).toContain(`button: translationKey("${PASS_IT_ON}"),`);
    expect(readRepoFile("MobileApp/src/oncall/passOn.ts")).toContain(
      `button: "${PASS_IT_ON}",`,
    );
    expect(section).toContain(
      `| OneUptime | **${PASS_IT_ON}** at the top of the incident, alert or episode, after its state buttons |`,
    );
    expect(section).toContain(
      `opens in the OneUptime On-Call app, with **${PASS_IT_ON}** under it |`,
    );
  });

  it("quotes what passing on will do as the server words it", () => {
    expect(PREVIEW_SENTENCE).toBe(
      "Escalation rule 2 of 3 (Level 2) is paged right away, without waiting.",
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

  it("quotes the feed's entry, and names the statuses the lists show", () => {
    expect(FEED_SENTENCE).toBe(
      "Alex Kim passed on the page from on-call policy Payments at escalation rule Level 1.",
    );
    expect(section).toContain(`the incident's feed says "${FEED_SENTENCE}"`);

    for (const status of [
      OnCallDutyExecutionLogTimelineStatus.PassedOn,
      UserNotificationExecutionStatus.PassedOn,
      UserNotificationStatus.PassedOn,
    ]) {
      expect(status).toBe("Passed On");
    }

    expect(section).toContain(
      "The run's **Execution Timeline** marks the person's line **Passed On**",
    );
    expect(section).toContain(
      "their **On-Call Logs** show the page as **Passed On**.",
    );
  });
});

describe("Personal On-Call Rules, on passing a page on", () => {
  it("says it beside acknowledging, and links to the section", () => {
    const rules: string = readPage("en", RULES_PAGE);
    const linking: Array<string> = linesLinkingTo(rules, SECTION_HEADING, true);

    expect(linking).toHaveLength(1);
    expect(linking[0]).toContain(
      `and a call asks you to press 1. When you cannot take a page, the same messages let you pass it on, and a call asks you to press ${ON_CALL_PAGE_CALL_PASS_ON_DIGIT}:`,
    );
  });
});

describe.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
  "the %s pages, on passing a page on",
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
        `**${PASS_IT_ON}**`,
        CANT_TAKE_IT_PASS_IT_ON,
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
