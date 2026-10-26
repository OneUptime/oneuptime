import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { AI_SRE } from "./AiDocsPages";
import { readPage } from "./DocsContentSupport";
import { drawnActionLabel } from "./DocsDashboardLabels";
import {
  AI_OFF_ASK_AI,
  AI_OFF_INVESTIGATION_CODES,
  AI_OFF_NOTES,
  AI_OFF_TITLES,
  AI_OFF_WHAT_YOU_CAN_DO,
} from "../../../FeatureSet/Dashboard/src/Components/AI/AiOffSummaryWords";
import {
  AI_LANE_SWITCHES,
  AiLane,
} from "../../../FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import { InvestigationNotStartedCode } from "Common/Types/AI/InvestigationNotStartedReason";
import { describe, expect, test } from "@jest/globals";

/*
 * When OneUptime AI neither investigated nor fixed an incident or alert
 * because AI was off for it, its AI card is one line: "AI investigation is
 * off" (or "AI is off for this project"), and why, with a chevron, "What you
 * can do", that opens what to turn on. The AI SRE page says so where it
 * describes the card - at the end of "Talk to OneUptime AI about the
 * incident" - in the words the line draws, and names each reason the line
 * folds for. What auto-remediation did and the two troubleshooting entries
 * point at the line, since the Remediation card is left out then. Every
 * language has the same words in the English ones' places, as its Dashboard
 * draws them.
 */

const CONVERSATION_HEADING: string =
  "## Talk to OneUptime AI about the incident";
const NEXT_HEADING: string = "## Enabling AI investigations";

const ENGLISH: string = readPage("en", AI_SRE);
const ENGLISH_LINES: Array<string> = ENGLISH.split("\n");

function lineStarting(start: string): number {
  return ENGLISH_LINES.findIndex((line: string): boolean => {
    return line.startsWith(start);
  });
}

const PARAGRAPH_LINE: number = lineStarting(
  "An incident or alert that OneUptime AI neither investigated nor fixed because AI was off for it",
);
const PARAGRAPH: string = ENGLISH_LINES[PARAGRAPH_LINE] || "";

// "What auto-remediation did": its last line, on an incident linked to nothing.
const REMEDIATION_DID_LINE: number = lineStarting(
  "When the incident is linked to no cluster and no infrastructure resource at all",
);
// Troubleshooting: "An incident was not investigated" and "Nothing was fixed".
const NOT_INVESTIGATED_LINE: number = lineStarting(
  "Its **AI Investigation** card says why:",
);
const NOTHING_FIXED_LINE: number = lineStarting(
  "The incident's **Remediation** card has a line for every way it could have been fixed",
);

const INVESTIGATE_SWITCH: string = AI_LANE_SWITCHES[AiLane.Incident][0]!.title;

/*
 * The four reasons the line folds for, each as the paragraph names it. A
 * reason added to the line and not to the page fails here.
 */
const REASON_WORDS: Record<string, string> = {
  ai_disabled: "off for the project",
  automatic_investigation_disabled: `_${INVESTIGATE_SWITCH}_ (or alerts) off when it was created`,
  no_investigation_rule_matched: "no AI rule that investigates matching it",
  severity_below_threshold: "its severity below the minimum",
};

const OTHER_LANGUAGES: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

describe("the AI SRE page says when the AI card is one line", () => {
  test("in a paragraph of its own closing the conversation section, after its list", () => {
    const start: number = ENGLISH_LINES.indexOf(CONVERSATION_HEADING);
    const end: number = ENGLISH_LINES.indexOf(NEXT_HEADING);

    expect(start).toBeGreaterThan(0);
    expect(PARAGRAPH_LINE).toBeGreaterThan(start);
    expect(end).toBe(PARAGRAPH_LINE + 2);
    expect(ENGLISH_LINES[PARAGRAPH_LINE - 1]).toBe("");
    expect(ENGLISH_LINES[PARAGRAPH_LINE - 2]?.startsWith("- **")).toBe(true);
    expect(ENGLISH_LINES[PARAGRAPH_LINE + 1]).toBe("");
  });

  test("the switch it names is the incident settings page's own", () => {
    expect(INVESTIGATE_SWITCH).toBe("Investigate new incidents");
  });

  test("names every reason the line folds for, and no other", () => {
    expect(Object.keys(REASON_WORDS).sort()).toEqual(
      [...AI_OFF_INVESTIGATION_CODES].sort(),
    );

    for (const code of AI_OFF_INVESTIGATION_CODES) {
      expect({
        code,
        named: PARAGRAPH.includes(
          REASON_WORDS[code as InvestigationNotStartedCode] as string,
        ),
      }).toEqual({ code, named: true });
    }
  });

  /*
   * The line's three titles: what is off now - for the record, or for the
   * whole project - and, once what was off is on again, that it was
   * (AiOffSummaryData's was-off title, which the page did not name).
   */
  test("names the line's three titles, its chevron and Ask OneUptime AI as the line draws them", () => {
    expect(AI_OFF_TITLES.investigationOff).toBe("AI investigation is off");
    expect(AI_OFF_TITLES.projectAiOff).toBe("AI is off for this project");
    expect(AI_OFF_TITLES.investigationWasOff).toBe("AI investigation was off");
    expect(AI_OFF_WHAT_YOU_CAN_DO).toBe("What you can do");
    expect(AI_OFF_ASK_AI).toBe("Ask OneUptime AI");

    expect(PARAGRAPH).toContain(
      `gets a one-line card instead: **${AI_OFF_TITLES.investigationOff}** (or **${AI_OFF_TITLES.projectAiOff}**, while it is; **${AI_OFF_TITLES.investigationWasOff}** once it is on again), and why.`,
    );
    // Every title the line can draw is named: none left out.
    for (const title of Object.values(AI_OFF_TITLES)) {
      expect(PARAGRAPH).toContain(`**${title}**`);
    }
    expect(PARAGRAPH).toContain(
      `Its chevron, **${AI_OFF_WHAT_YOU_CAN_DO}**, opens what to turn on`,
    );
    expect(PARAGRAPH).toContain(
      `While AI is on, **${AI_OFF_ASK_AI}** on the line opens the conversation`,
    );
  });

  test("says who is linked and who is told, and that a change does not reach back, as the line's note does", () => {
    expect(AI_OFF_NOTES.incident.aiOff).toBe(
      "This applies to new incidents only, not to this one.",
    );
    expect(AI_OFF_NOTES.alert.aiOff).toBe(
      "This applies to new alerts only, not to this one.",
    );
    expect(PARAGRAPH).toContain(
      "with a link to where it is changed for those who may change it and who can change it for everyone else",
    );
    expect(PARAGRAPH).toContain(
      "a change applies to new incidents and alerts only, not to this one.",
    );
  });

  test("says a conversation already started shows under the line, and the Remediation card is left out", () => {
    expect(PARAGRAPH).toContain(
      "a conversation someone has already started shows under the line by itself.",
    );
    expect(PARAGRAPH).toContain(
      "The **Remediation** card is left out then: the line says why nothing was fixed.",
    );
  });

  test("what auto-remediation did and both troubleshooting entries point at the line", () => {
    expect(REMEDIATION_DID_LINE).toBeGreaterThan(PARAGRAPH_LINE);
    expect(ENGLISH_LINES[REMEDIATION_DID_LINE]).toMatch(
      /When AI was off for an incident altogether, the \*\*AI Investigation\*\* card's one line says why nothing was fixed, and the \*\*Remediation\*\* card is left out\.$/,
    );
    expect(ENGLISH_LINES[NOT_INVESTIGATED_LINE]).toMatch(
      /When AI was off for the incident and nothing was fixed either, the card is one line: open \*\*What you can do\*\* on it to see what to turn on\.$/,
    );
    expect(ENGLISH_LINES[NOTHING_FIXED_LINE]).toMatch(
      /When AI was off for the incident altogether, the \*\*AI Investigation\*\* card's one line says so instead\.$/,
    );
  });
});

describe("every language says it in the English page's places", () => {
  test("there are languages to check", () => {
    expect(OTHER_LANGUAGES.length).toBe(16);
  });

  test.each(OTHER_LANGUAGES)(
    "%s has the paragraph where English has it, after the list and before the next section",
    (language: string) => {
      const lines: Array<string> = readPage(language, AI_SRE).split("\n");

      expect(lines.length).toBe(ENGLISH_LINES.length);
      expect(lines[PARAGRAPH_LINE - 1]).toBe("");
      expect(lines[PARAGRAPH_LINE - 2]?.startsWith("- **")).toBe(true);
      expect(lines[PARAGRAPH_LINE + 1]).toBe("");
      expect(lines[PARAGRAPH_LINE + 2]?.startsWith("## ")).toBe(true);
      expect(lines[PARAGRAPH_LINE]?.startsWith("- ")).toBe(false);
    },
  );

  test.each(OTHER_LANGUAGES)(
    "%s names the line's titles, its chevron, Ask OneUptime AI, the switch and the Remediation card as its Dashboard draws them",
    (language: string) => {
      const paragraph: string =
        readPage(language, AI_SRE).split("\n")[PARAGRAPH_LINE] || "";

      for (const label of [
        AI_OFF_TITLES.investigationOff,
        AI_OFF_TITLES.projectAiOff,
        AI_OFF_TITLES.investigationWasOff,
        AI_OFF_WHAT_YOU_CAN_DO,
        AI_OFF_ASK_AI,
        "Remediation",
      ]) {
        const drawn: string = drawnActionLabel(language, label);

        expect({ label, has: paragraph.includes(`**${drawn}**`) }).toEqual({
          label,
          has: true,
        });
      }

      // The three titles and the chevron are this language's own words.
      for (const label of [
        AI_OFF_TITLES.investigationOff,
        AI_OFF_TITLES.projectAiOff,
        AI_OFF_TITLES.investigationWasOff,
        AI_OFF_WHAT_YOU_CAN_DO,
      ]) {
        expect({ label, kept: paragraph.includes(`**${label}**`) }).toEqual({
          label,
          kept: false,
        });
      }

      expect(paragraph).toContain(
        `_${drawnActionLabel(language, INVESTIGATE_SWITCH)}_`,
      );
    },
  );

  test.each(OTHER_LANGUAGES)(
    "%s points at the line from what auto-remediation did and both troubleshooting entries",
    (language: string) => {
      const lines: Array<string> = readPage(language, AI_SRE).split("\n");
      const investigation: string = `**${drawnActionLabel(language, "AI Investigation")}**`;
      const remediation: string = `**${drawnActionLabel(language, "Remediation")}**`;
      const whatYouCanDo: string = `**${drawnActionLabel(language, AI_OFF_WHAT_YOU_CAN_DO)}**`;
      const remediationDid: string = lines[REMEDIATION_DID_LINE] || "";

      // Its own Remediation and AI Investigation cards, after what it said before.
      expect(
        remediationDid.slice(remediationDid.lastIndexOf(investigation)),
      ).toContain(remediation);
      expect(lines[NOT_INVESTIGATED_LINE]).toContain(whatYouCanDo);
      expect(lines[NOTHING_FIXED_LINE]).toContain(investigation);
      expect(lines[NOTHING_FIXED_LINE]).toContain(remediation);
    },
  );
});
