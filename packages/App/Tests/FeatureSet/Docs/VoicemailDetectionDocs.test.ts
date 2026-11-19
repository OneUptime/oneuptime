import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { VOICEMAIL_DETECTION_TITLE } from "../../../FeatureSet/Dashboard/src/Components/NotificationMethods/VoicemailDetectionWords";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import {
  CallOutcomeLine,
  getCallMachineAnsweredFeedSentence,
} from "Common/Types/OnCallDutyPolicy/OnCallSentLine";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * VOICEMAIL ON ON-CALL CALLS (#6594), AS THE DOCS SAY IT, IN EVERY DOCS
 * LANGUAGE.
 *
 *   - self-hosted/twilio-integration.md: a section, titled as the
 *     Dashboard titles the switch's card, says what voicemail detection
 *     does, that Twilio charges for it on the account that places the call,
 *     and where it is switched off - the card, by the Dashboard's name; the
 *     table of callback paths lists the answering machine callback, the
 *     inbound access table says Twilio reports who answered, and the
 *     security paragraph says the callback checks Twilio's signature;
 *   - incidents/notes-owners-and-feed.md quotes the feed's voicemail
 *     sentence, in English, as the feed writes it;
 *   - configuration/project-settings.md names the card among Notification
 *     Channels' More settings, linking to that section at its anchor.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");

const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

const CALLBACK_PATH: string =
  "`/notification/call/amd-callback/:callLogId/:token`";

function readPage(language: string, page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, page), "utf8");
}

// The section the switch's card is titled after, from its heading to the next one.
function voicemailSection(language: string): string {
  const lines: Array<string> = readPage(
    language,
    "self-hosted/twilio-integration.md",
  ).split("\n");
  const heading: string = `### ${drawnDashboardLabel(language, VOICEMAIL_DETECTION_TITLE)}`;
  const start: number = lines.findIndex((line: string): boolean => {
    // English titles its heading in sentence case, as its other headings.
    return line.toLowerCase() === heading.toLowerCase();
  });

  expect({ language, heading, found: start >= 0 }).toEqual({
    language,
    heading,
    found: true,
  });

  let end: number = start + 1;

  while (end < lines.length && !lines[end]!.startsWith("#")) {
    end++;
  }

  return lines.slice(start, end).join("\n");
}

describe("the docs on voicemail detection", () => {
  it("are checked in all seventeen docs languages", () => {
    expect(LANGUAGES).toHaveLength(17);
  });

  it("quote the feed's voicemail sentence as the feed writes it", () => {
    expect(
      getCallMachineAnsweredFeedSentence(CallOutcomeLine.VoicemailMessageLeft),
    ).toBe("It went to voicemail, and a message was left.");
  });

  it.each(LANGUAGES)(
    "%s: a section, titled as the Dashboard titles the card, says what it does, what Twilio charges and where it is switched off",
    (language: string) => {
      const section: string = voicemailSection(language);
      const card: string = `**${drawnDashboardLabel(language, VOICEMAIL_DETECTION_TITLE)}**`;

      // Twilio's own docs on answering machine detection.
      expect(section).toContain(
        "(https://www.twilio.com/docs/voice/answering-machine-detection)",
      );
      // The feed's words, in English, as the feed writes them.
      expect(section).toContain(
        "Nitin Kumar did not answer the phone call from on-call policy Payments at Level 1 of 3. It went to voicemail, and a message was left.",
      );
      // The card, by the Dashboard's name, under More settings.
      expect(section).toContain(card);
      expect(section).toContain(
        `**${drawnDashboardLabel(language, "More settings")}**`,
      );
      // Send Test Call is never checked, by the Dashboard's name.
      expect(section).toContain(
        `**${drawnDashboardLabel(language, "Send Test Call")}**`,
      );
    },
  );

  it.each(LANGUAGES)(
    "%s: the callback table lists the answering machine callback, after the call outcome's",
    (language: string) => {
      const page: string = readPage(
        language,
        "self-hosted/twilio-integration.md",
      );
      const rows: Array<string> = page.split("\n").filter((line: string) => {
        return line.startsWith("| POST | `/notification/call/");
      });

      expect(rows).toHaveLength(2);
      expect(rows[0]).toContain(
        "`/notification/call/status-callback/:callLogId/:token`",
      );
      expect(rows[1]).toContain(CALLBACK_PATH);
    },
  );

  it.each(LANGUAGES)(
    "%s: the security paragraph says the voicemail callback checks Twilio's signature",
    (language: string) => {
      const paragraph: string | undefined = readPage(
        language,
        "self-hosted/twilio-integration.md",
      )
        .split("\n")
        .find((line: string): boolean => {
          return line.includes("`X-Twilio-Signature`");
        });

      expect(paragraph).toBeDefined();
      // Twilio is named twice: incoming calls' check, and the voicemail callback's.
      expect((paragraph!.match(/Twilio/g) || []).length).toBeGreaterThanOrEqual(
        4,
      );
    },
  );

  it.each(LANGUAGES)(
    "%s: the incident feed's page quotes the voicemail sentence",
    (language: string) => {
      expect(
        readPage(language, "incidents/notes-owners-and-feed.md"),
      ).toContain("… It went to voicemail, and a message was left.");
    },
  );

  it.each(LANGUAGES)(
    "%s: Notification Channels names the card, linking to the section at its anchor",
    (language: string) => {
      const settings: string = readPage(
        language,
        "configuration/project-settings.md",
      );
      const title: string = drawnDashboardLabel(
        language,
        VOICEMAIL_DETECTION_TITLE,
      );
      const heading: string = voicemailSection(language)
        .split("\n")[0]!
        .replace(/^### /, "");
      const link: string = `(/docs/self-hosted/twilio-integration#${slugifyMarkdownHeading(heading)})`;

      expect(settings).toContain(`**${title}**`);
      expect({ language, link, linked: settings.includes(link) }).toEqual({
        language,
        link,
        linked: true,
      });
    },
  );
});
